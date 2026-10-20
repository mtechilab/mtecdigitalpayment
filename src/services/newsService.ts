import { randomUUID } from "crypto";
import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validatePost, validateImage, isVisible } from "./newsPolicy.js";

const NEWS_BUCKET = "news-images";
const THUMB_BUCKET = "programme-thumbnails";
const LINK_SECONDS = 3600;

interface PostRow {
  id: string; kind: string; title: string; body: string; audience: string; image_path: string | null;
  published_at: string; expires_at: string | null; author: string;
}

function extFor(contentType: string): string {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

async function imageLink(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await getSupabase().storage.from(bucket).createSignedUrl(path, LINK_SECONDS);
  return data?.signedUrl || null;
}

/** Admin: publish a news item or a notice, for everyone or for one programme, with an optional image. */
export async function createPost(admin: string, input: {
  kind: unknown; title: unknown; body: unknown; audience: unknown; expiresAt: unknown; imageBase64?: unknown; imageType?: unknown;
}) {
  const problem = validatePost(input);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const audience = (input.audience as string).trim();
  if (audience !== "all") {
    const { data: prog } = await supabase.from("programmes").select("name").eq("name", audience).maybeSingle();
    if (!prog) throw new Error("Choose 'Everyone' or a programme that exists.");
  }
  const id = randomUUID();
  let imagePath: string | null = null;
  let imageType: string | null = null;
  if (input.imageBase64) {
    const imgProblem = validateImage(input.imageType, input.imageBase64);
    if (imgProblem) throw new Error(imgProblem);
    imageType = input.imageType as string;
    imagePath = `${id}.${extFor(imageType)}`;
    const { error: upErr } = await supabase.storage.from(NEWS_BUCKET)
      .upload(imagePath, Buffer.from(input.imageBase64 as string, "base64"), { contentType: imageType, upsert: false });
    if (upErr) throw new Error(`Could not store the image: ${upErr.message}`);
  }
  const { error } = await supabase.from("news_posts").insert({
    id, kind: input.kind as string, title: (input.title as string).trim(), body: (input.body as string).trim(),
    audience, image_path: imagePath, expires_at: input.expiresAt ? String(input.expiresAt) : null, author: admin,
  });
  if (error) {
    if (imagePath) await supabase.storage.from(NEWS_BUCKET).remove([imagePath]);
    throw new Error(`createPost failed: ${error.message}`);
  }
  await recordAudit({ actor: admin, action: "news.publish", entityType: "news_post", entityId: id, detail: { kind: input.kind, audience } });
  return { id };
}

/** Admin: every post, including expired ones. */
export async function listPostsForAdmin() {
  const { data, error } = await getSupabase().from("news_posts")
    .select("id, kind, title, audience, published_at, expires_at, author, image_path")
    .order("published_at", { ascending: false }).limit(200);
  if (error) throw new Error(`listPostsForAdmin failed: ${error.message}`);
  return ((data || []) as unknown as PostRow[]).map((p) => ({
    id: p.id, kind: p.kind, title: p.title, audience: p.audience, publishedAt: p.published_at,
    expiresAt: p.expires_at, author: p.author, hasImage: !!p.image_path,
  }));
}

/** Admin: remove a post and its image. */
export async function deletePost(admin: string, id: string) {
  const supabase = getSupabase();
  const { data } = await supabase.from("news_posts").select("image_path").eq("id", id).maybeSingle();
  const path = (data as unknown as { image_path: string | null } | null)?.image_path;
  const { error } = await supabase.from("news_posts").delete().eq("id", id);
  if (error) throw new Error(`deletePost failed: ${error.message}`);
  if (path) await supabase.storage.from(NEWS_BUCKET).remove([path]);
  await recordAudit({ actor: admin, action: "news.delete", entityType: "news_post", entityId: id, detail: {} });
  return { success: true };
}

/** Student: the posts meant for them, newest first, with an unread count. */
export async function feedForStudent(studentRowId: string) {
  const supabase = getSupabase();
  const { data: student } = await supabase.from("students").select("programme").eq("id", studentRowId).maybeSingle();
  const programme = (student as unknown as { programme: string } | null)?.programme || "";
  const { data, error } = await supabase.from("news_posts")
    .select("id, kind, title, body, audience, image_path, published_at, expires_at, author")
    .order("published_at", { ascending: false }).limit(200);
  if (error) throw new Error(`feedForStudent failed: ${error.message}`);
  const visible = ((data || []) as unknown as PostRow[]).filter((p) => isVisible(p.audience, p.expires_at, programme));
  const { data: reads } = await supabase.from("news_reads").select("post_id").eq("student_row_id", studentRowId);
  const readIds = new Set(((reads || []) as unknown as { post_id: string }[]).map((r) => r.post_id));
  const posts = await Promise.all(visible.map(async (p) => ({
    id: p.id, kind: p.kind, title: p.title, body: p.body, audience: p.audience, publishedAt: p.published_at,
    author: p.author, read: readIds.has(p.id), imageUrl: await imageLink(NEWS_BUCKET, p.image_path),
  })));
  return { posts, unreadCount: posts.filter((p) => !p.read).length };
}

/** Student: marks a post as read. */
export async function markRead(studentRowId: string, postId: string) {
  const { error } = await getSupabase().from("news_reads")
    .upsert({ post_id: postId, student_row_id: studentRowId }, { onConflict: "post_id,student_row_id" });
  if (error) throw new Error(`markRead failed: ${error.message}`);
  return { success: true };
}

/** Admin: sets a programme's thumbnail image. Replaces any earlier one. */
export async function setProgrammeThumbnail(admin: string, programmeId: string, base64: unknown, contentType: unknown) {
  const problem = validateImage(contentType, base64);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const { data: prog } = await supabase.from("programmes").select("id, thumbnail_path").eq("id", programmeId).maybeSingle();
  const row = prog as unknown as { id: string; thumbnail_path: string | null } | null;
  if (!row) throw new Error("That programme was not found.");
  const path = `${programmeId}.${extFor(contentType as string)}`;
  const { error: upErr } = await supabase.storage.from(THUMB_BUCKET)
    .upload(path, Buffer.from(base64 as string, "base64"), { contentType: contentType as string, upsert: true });
  if (upErr) throw new Error(`Could not store the image: ${upErr.message}`);
  const { error } = await supabase.from("programmes").update({ thumbnail_path: path, thumbnail_type: contentType as string }).eq("id", programmeId);
  if (error) throw new Error(`setProgrammeThumbnail failed: ${error.message}`);
  await recordAudit({ actor: admin, action: "programme.thumbnail", entityType: "programme", entityId: programmeId, detail: {} });
  return { success: true, thumbnailUrl: await imageLink(THUMB_BUCKET, path) };
}

/** A programme's thumbnail link, or null when none has been set. */
export async function thumbnailLink(path: string | null): Promise<string | null> {
  return imageLink(THUMB_BUCKET, path);
}
