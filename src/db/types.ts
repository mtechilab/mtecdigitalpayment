// Minimal hand-written Database type — covers only the tables this
// backend actually touches, matching supabase/schema.sql column-for-
// column. Normally generated via `supabase gen types typescript`, but
// written by hand here since there's no live Supabase project to
// generate against yet. If columns drift from schema.sql, regenerate
// this properly once the project exists.
//
// Shape (Row/Insert/Update/Relationships per table, Tables/Views/
// Functions per schema) matches @supabase/postgrest-js's GenericSchema —
// confirmed against the installed package's own type definitions rather
// than assumed, since this version requires Relationships explicitly.

export interface Database {
  public: {
    Tables: {
      programmes: {
        Row: {
          id: string; active: boolean; name: string; department: string; duration_years: number; duration_label: string;
          category: string; mode: string; description: string; intake_label: string;
        };
        Insert: Partial<Database["public"]["Tables"]["programmes"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["programmes"]["Row"]>;
        Relationships: [];
      };
      payment_plans: {
        Row: {
          id: string;
          student_row_id: string;
          programme_id: string;
          label: string;
          frequency: string;
          period_amount: number;
          total_amount: number;
          plan_start_date: string;
          plan_end_date: string;
          status: string;
          created_at: string;
          programmes?: { name: string; duration_years: number } | null;
          monime_recurrent_code_id: string | null;
          monime_recurrent_ussd_code: string | null;
          monime_recurrent_expire_time: string | null;
          monime_recurrent_amount: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_plans"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["payment_plans"]["Row"]>;
        Relationships: [];
      };
      payment_periods: {
        Row: {
          id: string;
          payment_plan_id: string;
          period_label: string;
          period_index: number;
          due_date: string;
          amount_due: number;
          amount_paid: number;
          status: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_periods"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["payment_periods"]["Row"]>;
        Relationships: [];
      };
      payment_submissions: {
        Row: {
          proof_path: string | null;
          proof_uploaded_at: string | null;
          monime_order_number: string | null;
          monime_payload: unknown | null;
          webhook_received_at: string | null;
          id: string;
          mtec_reference: string;
          payment_plan_id: string;
          payment_period_id: string | null;
          student_row_id: string;
          amount: number;
          method: string;
          provider_reference: string | null;
          status: string;
          verified_by: string | null;
          verified_at: string | null;
          rejection_reason: string | null;
          created_at: string;
          monime_payment_code_id: string | null;
          monime_payment_id: string | null;
          monime_transaction_reference: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_submissions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["payment_submissions"]["Row"]>;
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          student_id: string;
          student_pin: string;
          password_hash: string | null;
          first_login_complete: boolean;
          application_id: string;
          full_name: string;
          phone: string;
          email: string;
          programme: string;
          academic_year: string;
          level: string;
          status: string;
          created_at: string;
          profile_photo_path: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["students"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["students"]["Row"]>;
        Relationships: [];
      };
      receipts: {
        Row: {
          id: string;
          receipt_number: string;
          student_row_id: string;
          student_id_number: string;
          student_name: string;
          programme: string;
          amount: number;
          method: string;
          date: string;
          received_by: string;
          previous_balance: number;
          new_balance: number;
        };
        Insert: Partial<Database["public"]["Tables"]["receipts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["receipts"]["Row"]>;
        Relationships: [];
      };
      admin_accounts: {
        Row: { id: string; username: string; password_hash: string; full_name: string; role: string; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["admin_accounts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["admin_accounts"]["Row"]>;
        Relationships: [];
      };
      courses: {
        Row: { id: string; code: string; name: string; programme: string; level: string; semester: string; credit_units: number };
        Insert: Partial<Database["public"]["Tables"]["courses"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["courses"]["Row"]>;
        Relationships: [];
      };
      marks: {
        Row: { id: string; assessment_item_id: string; class_id: string; student_row_id: string; score: number; classes?: { courses?: { code: string; name: string } | null } | null; assessment_items?: { name: string; max_score: number; weight: number } | null };
        Insert: Partial<Database["public"]["Tables"]["marks"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["marks"]["Row"]>;
        Relationships: [];
      };
      result_batches: {
        Row: { class_id: string; status: string; sent_back_reason: string | null; submitted_at: string | null; published_at: string | null };
        Insert: Partial<Database["public"]["Tables"]["result_batches"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["result_batches"]["Row"]>;
        Relationships: [];
      };
      classes: {
        Row: { id: string; course_id: string; instructor_name: string; academic_year: string; student_ids: string[]; courses?: { code: string; name: string; credit_units: number; semester: string } | null };
        Insert: Partial<Database["public"]["Tables"]["classes"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["classes"]["Row"]>;
        Relationships: [];
      };
      timetable_slots: {
        Row: { id: string; class_id: string; day_of_week: string; start_time: string; end_time: string; room: string; classes?: { courses?: { code: string; name: string } | null } | null };
        Insert: Partial<Database["public"]["Tables"]["timetable_slots"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["timetable_slots"]["Row"]>;
        Relationships: [];
      };
      attendance_records: {
        Row: { id: string; class_id: string; student_row_id: string; date: string; mark: string; classes?: { courses?: { code: string; name: string } | null } | null };
        Insert: Partial<Database["public"]["Tables"]["attendance_records"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["attendance_records"]["Row"]>;
        Relationships: [];
      };
      assessment_items: {
        Row: { id: string; class_id: string; name: string; max_score: number; weight: number };
        Insert: Partial<Database["public"]["Tables"]["assessment_items"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["assessment_items"]["Row"]>;
        Relationships: [];
      };
      applications: {
        Row: {
          id: string; declaration_date: string | null; declaration_name: string | null; guardian: unknown; enrollment_category: string | null; programme_level: string | null; application_number: string | null; pin_id: string; status: string;
          full_name: string; other_name: string; gender: string; date_of_birth: string; nationality: string;
          phone: string; whatsapp: string; email: string; address: string; district: string; city_town: string;
          academic_year: string; intake: string; programme: string; study_mode: string;
          education: any; emergency_contact: any; documents: any; declaration_confirmed: boolean;
          rejection_reason: string | null; created_at: string; submitted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["applications"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["applications"]["Row"]>;
        Relationships: [];
      };
      application_pins: {
        Row: {
          id: string; pin: string; password_hash: string | null; academic_year: string; intake: string;
          status: string; source: string; applicant_name: string; applicant_phone: string;
          applicant_email: string | null; programme_interest: string; payment_transaction_id: string | null;
          issued_by: string | null; created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["application_pins"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["application_pins"]["Row"]>;
        Relationships: [];
      };
      fee_structures: {
        Row: { programme: string; registration_fee: number; tuition_per_semester: number };
        Insert: Partial<Database["public"]["Tables"]["fee_structures"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["fee_structures"]["Row"]>;
        Relationships: [];
      };
      academic_levels: {
        Row: { id: string; name: string; sort_order: number; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["academic_levels"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["academic_levels"]["Row"]>;
        Relationships: [];
      };
      semesters: {
        Row: { id: string; name: string; sort_order: number; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["semesters"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["semesters"]["Row"]>;
        Relationships: [];
      };
      programme_requests: {
        Row: { id: string; programme_name: string; application_id: string | null; status: string; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["programme_requests"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["programme_requests"]["Row"]>;
        Relationships: [];
      };
      admin_audit_log: {
        Row: { id: string; actor: string; action: string; entity_type: string; entity_id: string; detail: unknown | null; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["admin_audit_log"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["admin_audit_log"]["Row"]>;
        Relationships: [];
      };
      staff_accounts: {
        Row: { id: string; username: string; password_hash: string; full_name: string; role: string; active: boolean; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["staff_accounts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["staff_accounts"]["Row"]>;
        Relationships: [];
      };
      library_items: {
        Row: { id: string; title: string; description: string; programme: string; course_code: string; semester: string; academic_year: string; topic: string; material_type: string; status: string; uploaded_by_staff_id: string | null; uploaded_by_name: string; current_version: number; published_version: number | null; published_at: string | null; approved_by: string | null; rejection_reason: string | null; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["library_items"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["library_items"]["Row"]>;
        Relationships: [];
      };
      library_versions: {
        Row: { id: string; item_id: string; version: number; storage_path: string; file_name: string; content_type: string; size_bytes: number; uploaded_by_name: string; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["library_versions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["library_versions"]["Row"]>;
        Relationships: [];
      };
      ai_drafts: {
        Row: { id: string; group_id: string; version: number; owner_staff_id: string; owner_name: string; kind: string; title: string; programme: string; course_code: string; topic: string; instructions: string; content: string; status: string; approved_at: string | null; created_at: string; updated_at: string };
        Insert: Partial<Database["public"]["Tables"]["ai_drafts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["ai_drafts"]["Row"]>;
        Relationships: [];
      };
      ai_usage: {
        Row: { month: string; calls: number; tokens: number };
        Insert: Partial<Database["public"]["Tables"]["ai_usage"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["ai_usage"]["Row"]>;
        Relationships: [];
      };
      quizzes: {
        Row: { id: string; owner_staff_id: string; owner_name: string; title: string; programme: string; course_code: string; status: string; published_at: string | null; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["quizzes"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["quizzes"]["Row"]>;
        Relationships: [];
      };
      quiz_questions: {
        Row: { id: string; quiz_id: string; position: number; question: string; options: unknown; correct_index: number };
        Insert: Partial<Database["public"]["Tables"]["quiz_questions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["quiz_questions"]["Row"]>;
        Relationships: [];
      };
      quiz_attempts: {
        Row: { id: string; quiz_id: string; student_row_id: string; score: number; total: number; answers: unknown; submitted_at: string };
        Insert: Partial<Database["public"]["Tables"]["quiz_attempts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["quiz_attempts"]["Row"]>;
        Relationships: [];
      };
      assignments: {
        Row: { id: string; owner_staff_id: string; owner_name: string; title: string; instructions: string; programme: string; course_code: string; due_at: string; status: string; published_at: string | null; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["assignments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["assignments"]["Row"]>;
        Relationships: [];
      };
      assignment_submissions: {
        Row: { id: string; assignment_id: string; student_row_id: string; body: string; submitted_at: string; score: number | null; feedback: string | null; graded_at: string | null };
        Insert: Partial<Database["public"]["Tables"]["assignment_submissions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["assignment_submissions"]["Row"]>;
        Relationships: [];
      };
      conversations: {
        Row: { id: string; kind: string; title: string; programme: string | null; class_id: string | null; created_by_staff_id: string | null; created_by_name: string; created_by_student_id: string | null; created_by_kind: string | null; created_by_id: string | null; last_message_at: string | null; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["conversations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["conversations"]["Row"]>;
        Relationships: [];
      };
      conversation_members: {
        Row: { conversation_id: string; member_kind: string; member_id: string; member_name: string };
        Insert: Partial<Database["public"]["Tables"]["conversation_members"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["conversation_members"]["Row"]>;
        Relationships: [];
      };
      messages: {
        Row: { id: string; conversation_id: string; sender_kind: string; sender_id: string; sender_name: string; kind: string; body: string | null; voice_path: string | null; voice_seconds: number | null; file_path: string | null; file_name: string | null; file_type: string | null; file_size: number | null; reply_to: string | null; deleted_for_everyone: boolean; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["messages"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["messages"]["Row"]>;
        Relationships: [];
      };
      conversation_reads: {
        Row: { conversation_id: string; reader_kind: string; reader_id: string; last_read_at: string };
        Insert: Partial<Database["public"]["Tables"]["conversation_reads"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["conversation_reads"]["Row"]>;
        Relationships: [];
      };
      message_hidden: {
        Row: { message_id: string; viewer_kind: string; viewer_id: string };
        Insert: Partial<Database["public"]["Tables"]["message_hidden"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["message_hidden"]["Row"]>;
        Relationships: [];
      };
      message_reactions: {
        Row: { message_id: string; reactor_kind: string; reactor_id: string; reaction: string; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["message_reactions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["message_reactions"]["Row"]>;
        Relationships: [];
      };
      conversation_typing: {
        Row: { conversation_id: string; member_kind: string; member_id: string; member_name: string; updated_at: string };
        Insert: Partial<Database["public"]["Tables"]["conversation_typing"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["conversation_typing"]["Row"]>;
        Relationships: [];
      };
      calls: {
        Row: { id: string; conversation_id: string; caller_kind: string; caller_id: string; caller_name: string; callee_kind: string; callee_id: string; mode: string; status: string; created_at: string; answered_at: string | null; ended_at: string | null; duration_seconds: number | null };
        Insert: Partial<Database["public"]["Tables"]["calls"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["calls"]["Row"]>;
        Relationships: [];
      };
      call_signals: {
        Row: { id: number; call_id: string; from_kind: string; from_id: string; to_kind: string; to_id: string; kind: string; payload: unknown; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["call_signals"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["call_signals"]["Row"]>;
        Relationships: [];
      };
      application_fees: {
        Row: { level: string; amount: number; updated_at: string; updated_by: string | null };
        Insert: Partial<Database["public"]["Tables"]["application_fees"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["application_fees"]["Row"]>;
        Relationships: [];
      };
      application_payments: {
        Row: { id: string; application_id: string; method: string; amount: number; reference: string | null; receipt_path: string | null; receipt_type: string | null; status: string; review_reason: string | null; submitted_at: string; reviewed_at: string | null; reviewed_by: string | null };
        Insert: Partial<Database["public"]["Tables"]["application_payments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["application_payments"]["Row"]>;
        Relationships: [];
      };
      chat_messages: {
        Row: { id: string; student_row_id: string; sender_type: string; sender_name: string; message: string; created_at: string; students?: { student_id: string; full_name: string } | null };
        Insert: Partial<Database["public"]["Tables"]["chat_messages"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Row"]>;
        Relationships: [];
      };
      offer_letters: {
        Row: {
          id: string; application_id: string; student_name: string; application_number: string;
          programme: string; academic_year: string; admission_conditions: string; fees_amount: number;
          reporting_date: string; authorized_signatory: string; generated_at: string; acceptance_deadline: string;
        };
        Insert: Partial<Database["public"]["Tables"]["offer_letters"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["offer_letters"]["Row"]>;
        Relationships: [];
      };
      acceptance_letters: {
        Row: { id: string; student_row_id: string; offer_letter_id: string; student_id_number: string; generated_at: string };
        Insert: Partial<Database["public"]["Tables"]["acceptance_letters"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["acceptance_letters"]["Row"]>;
        Relationships: [];
      };
      processed_webhook_events: {
        Row: { event_id: string; processed_at: string };
        Insert: Partial<Database["public"]["Tables"]["processed_webhook_events"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["processed_webhook_events"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
