-- Let students complete the contact and school fields required by the teacher
-- after creating an account with Google. Role and approval status stay locked.
grant update(full_name, whatsapp_number, phone_number, school_name, governorate, academic_branch)
  on public.profiles to authenticated;
