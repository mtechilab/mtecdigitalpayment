import { getSupabase } from "../db/supabaseClient.js";
import { validateProfilePhoto, extensionFor } from "./profilePhotoPolicy.js";

const BUCKET = "profile-photos";
const LINK_SECONDS = 3600;

/** Replaces the student's photo. The old file is removed only after the new one is saved. */
export async function uploadProfilePhoto(studentRowId: string, contentType: string, base64: string) {
  const problem = validateProfilePhoto(contentType, base64);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();

  const { data: current, error: readError } = await supabase.from("students")
    .select("profile_photo_path").eq("id", studentRowId).maybeSingle();
  if (readError) throw new Error(`uploadProfilePhoto failed: ${readError.message}`);
  if (!current) throw new Error("Student not found.");

  const path = `${studentRowId}/${Date.now()}.${extensionFor(contentType)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET)
    .upload(path, Buffer.from(base64, "base64"), { contentType, upsert: false });
  if (uploadError) throw new Error(`Could not store the photo: ${uploadError.message}`);

  const { error: updateError } = await supabase.from("students")
    .update({ profile_photo_path: path }).eq("id", studentRowId);
  if (updateError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Could not save the photo: ${updateError.message}`);
  }
  const previous = current.profile_photo_path as string | null;
  if (previous) await supabase.storage.from(BUCKET).remove([previous]);
  return { success: true };
}

/** A short-lived link to the student's current photo, or null if they have none. */
export async function profilePhotoUrl(studentRowId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("students")
    .select("profile_photo_path").eq("id", studentRowId).maybeSingle();
  if (error) throw new Error(`profilePhotoUrl failed: ${error.message}`);
  const path = data?.profile_photo_path as string | null;
  if (!path) return null;
  const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (signError || !signed) throw new Error(`Could not create the photo link: ${signError?.message || "unknown"}`);
  return signed.signedUrl;
}
