import { getSupabase } from "../db/supabaseClient.js";

/** Every report is the same table shape so one Android screen can render
 *  (and share) all of them. Aggregation happens here in JS over plain
 *  selects — fine at this school's data volume, and it avoids adding SQL
 *  views/RPCs that would need their own migration. */
export interface Report {
  title: string;
  columns: string[];
  rows: string[][];
  total?: string[];
}

export const REPORT_TYPES = [
  "enrollment", "course-enrollment", "attendance", "results",
  "fee-collection", "outstanding-fees", "payment-plans",
  "applications", "programme-stats",
] as const;
export type ReportType = typeof REPORT_TYPES[number];

const money = (n: number) => `NLe ${Math.round(n).toLocaleString("en-US")}`;

function countBy<T>(items: T[], key: (i: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) || 0) + 1);
  return m;
}

export async function buildReport(type: ReportType): Promise<Report> {
  const supabase = getSupabase();

  switch (type) {
    case "enrollment": {
      const { data, error } = await supabase.from("students").select("programme").eq("status", "active");
      if (error) throw new Error(`enrollment report failed: ${error.message}`);
      const counts = countBy(data || [], (s: any) => s.programme);
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => [p, String(n)]);
      return { title: "Student Enrollment", columns: ["Programme", "Students"], rows,
        total: ["TOTAL", String((data || []).length)] };
    }

    case "course-enrollment": {
      const { data, error } = await supabase.from("classes").select("academic_year, student_ids, courses(code, name)");
      if (error) throw new Error(`course-enrollment report failed: ${error.message}`);
      const rows = (data || []).map((c: any) =>
        [`${c.courses?.code || ""} ${c.courses?.name || ""}`.trim(), c.academic_year, String((c.student_ids || []).length)]);
      const total = (data || []).reduce((s: number, c: any) => s + (c.student_ids || []).length, 0);
      return { title: "Course Enrollment", columns: ["Course", "Year", "Students"], rows,
        total: ["TOTAL ENROLMENTS", "", String(total)] };
    }

    case "attendance": {
      const [classesRes, recordsRes] = await Promise.all([
        supabase.from("classes").select("id, courses(code, name)"),
        supabase.from("attendance_records").select("class_id, mark"),
      ]);
      if (classesRes.error) throw new Error(`attendance report failed: ${classesRes.error.message}`);
      if (recordsRes.error) throw new Error(`attendance report failed: ${recordsRes.error.message}`);
      const tally = new Map<string, Record<string, number>>();
      for (const r of recordsRes.data || []) {
        const t = tally.get(r.class_id) || { present: 0, absent: 0, late: 0, excused: 0 };
        t[r.mark] = (t[r.mark] || 0) + 1;
        tally.set(r.class_id, t);
      }
      const rows = (classesRes.data || []).map((c: any) => {
        const t = tally.get(c.id) || { present: 0, absent: 0, late: 0, excused: 0 };
        const all = t.present + t.absent + t.late + t.excused;
        const rate = all > 0 ? `${Math.round(((t.present + t.late) / all) * 100)}%` : "—";
        return [`${c.courses?.code || ""} ${c.courses?.name || ""}`.trim(), String(t.present), String(t.absent), String(t.late), String(t.excused), rate];
      });
      return { title: "Attendance", columns: ["Class", "Present", "Absent", "Late", "Excused", "Rate"], rows };
    }

    case "results": {
      const [classesRes, batchesRes] = await Promise.all([
        supabase.from("classes").select("id, courses(code, name)"),
        supabase.from("result_batches").select("class_id, status"),
      ]);
      if (classesRes.error) throw new Error(`results report failed: ${classesRes.error.message}`);
      if (batchesRes.error) throw new Error(`results report failed: ${batchesRes.error.message}`);
      const statusByClass = new Map<string, string>();
      for (const b of (batchesRes.data || []) as any[]) statusByClass.set(b.class_id, b.status);
      const rows = (classesRes.data || []).map((c: any) =>
        [`${c.courses?.code || ""} ${c.courses?.name || ""}`.trim(), (statusByClass.get(c.id) || "draft").replace("_", " ")]);
      const counts = countBy<string[]>(rows, (r) => r[1]);
      const summary = [...counts.entries()].map(([s, n]) => `${s}: ${n}`).join("  ");
      return { title: "Results Status", columns: ["Class", "Status"], rows, total: ["SUMMARY", summary] };
    }

    case "fee-collection": {
      const { data, error } = await supabase.from("receipts").select("programme, amount");
      if (error) throw new Error(`fee-collection report failed: ${error.message}`);
      const sums = new Map<string, number>();
      for (const r of data || []) sums.set(r.programme, (sums.get(r.programme) || 0) + Number(r.amount));
      const rows = [...sums.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => [p, money(n)]);
      const total = [...sums.values()].reduce((a, b) => a + b, 0);
      return { title: "Fee Collection", columns: ["Programme", "Collected"], rows, total: ["TOTAL", money(total)] };
    }

    case "outstanding-fees": {
      const { data, error } = await supabase
        .from("payment_periods")
        .select("amount_due, amount_paid, payment_plans(students(full_name, student_id))")
        .neq("status", "paid");
      if (error) throw new Error(`outstanding-fees report failed: ${error.message}`);
      const owed = new Map<string, { name: string; amount: number }>();
      for (const p of (data || []) as any[]) {
        const s = p.payment_plans?.students;
        if (!s) continue;
        const cur = owed.get(s.student_id) || { name: s.full_name, amount: 0 };
        cur.amount += Number(p.amount_due) - Number(p.amount_paid);
        owed.set(s.student_id, cur);
      }
      const list = [...owed.entries()].filter(([, v]) => v.amount > 0).sort((a, b) => b[1].amount - a[1].amount);
      const rows = list.map(([id, v]) => [v.name, id, money(v.amount)]);
      const total = list.reduce((s, [, v]) => s + v.amount, 0);
      return { title: "Outstanding Fees", columns: ["Student", "ID", "Owing"], rows, total: ["TOTAL", "", money(total)] };
    }

    case "payment-plans": {
      const { data, error } = await supabase.from("payment_plans").select("status");
      if (error) throw new Error(`payment-plans report failed: ${error.message}`);
      const rows = [...countBy(data || [], (p: any) => p.status).entries()].map(([s, n]) => [s, String(n)]);
      return { title: "Payment Plans", columns: ["Status", "Plans"], rows, total: ["TOTAL", String((data || []).length)] };
    }

    case "applications": {
      const { data, error } = await supabase.from("applications").select("status").neq("status", "draft");
      if (error) throw new Error(`applications report failed: ${error.message}`);
      const rows = [...countBy(data || [], (a: any) => a.status).entries()].map(([s, n]) => [s.replace("_", " "), String(n)]);
      return { title: "Applications", columns: ["Status", "Applications"], rows, total: ["TOTAL", String((data || []).length)] };
    }

    case "programme-stats": {
      const { data, error } = await supabase.from("applications").select("programme, status").neq("status", "draft");
      if (error) throw new Error(`programme-stats report failed: ${error.message}`);
      const byProgramme = new Map<string, { applied: number; approved: number }>();
      for (const a of (data || []) as any[]) {
        const cur = byProgramme.get(a.programme) || { applied: 0, approved: 0 };
        cur.applied++;
        if (a.status === "approved") cur.approved++;
        byProgramme.set(a.programme, cur);
      }
      const rows = [...byProgramme.entries()].sort((a, b) => b[1].applied - a[1].applied)
        .map(([p, v]) => [p, String(v.applied), String(v.approved)]);
      return { title: "Programme Statistics", columns: ["Programme", "Applied", "Approved"], rows };
    }
  }
}
