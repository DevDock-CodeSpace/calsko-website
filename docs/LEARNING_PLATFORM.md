# Learning platform

The owner's model (2026-11-01) is a learning platform built on groups:
- A group is an academy or school. Its owner and admins add **teachers**.
- Teachers create and teach **their own courses**.
- Students **enroll course by course**, either in open courses or with a course code.

Payment comes later. It will only issue codes automatically; everything else is already here.

## Roles

| Group role | Can |
|---|---|
| Owner | Everything. Makes people admins, teachers or members |
| Admin | Manages the group and every course. Switches people between member and teacher |
| **Teacher** | Creates courses (`create_course`) and teaches them (lead). Adds co-teachers from the group's teachers and admins (`set_course_teacher`). Makes course codes and adds students to their courses. Sees only their own courses and students |
| Member | A student. Enrolls in open courses (`enroll_in_course`) or uses a course code |

- A **teacher** made a member again stops leading their courses (`drop_former_teacher_leads`). The courses stay, with their other teachers and the admins. An admin made a member keeps leading: in company groups, ordinary members often lead a course (a senior engineer leading onboarding).
- A course always keeps one teacher.
- Teachers can't create projects or spaces, change access settings, or invite people to the whole group. They bring students in with course codes.

The role is called **Teacher** in learning groups and **Trainer** elsewhere, for example a company's senior engineer running onboarding (`teamRoleName`). This is display only: it is `teacher` in code and the database.

## Enrollment

- A course is enrolled-only (`access = 'members'`). Its students are its `workspace_members` with role member, and its teachers are its leads.
- `workspaces.enrollment` says how students get in:
  - **open**: anyone in the group can enroll from Learning → Browse courses, and codes work too;
  - **invite**: only people the teachers add, or who use a code.
- New courses are enrolled-only (`defaultAccess`).
- Courses that existed before this change and were open to their group or collection kept those people as enrolled students and became open courses. Nobody lost a course.

## Course codes (`course_codes`)

- A code is single-use, for one course, in the same `XXXX-XXXX-XXXX` shape as group invites, without look-alike characters.
- The course's teachers and the group's admins make them (`create_course_codes`, 1–50 at a time, with an optional "for" note), read them, and withdraw unused ones (`revoke_course_code`).
- Redeeming goes through `join_with_code`, the same box as group invites (onboarding, and Learning → Use a course code). It joins the group as a member, enrolls in that course only, and marks the code used. The same person using it again is a no-op; anyone else is refused.
- `kind = 'free'` is fee waived. `'paid'` is reserved for checkout, which will issue a paid code per purchase (and email it, or redeem it straight away for a signed-in buyer).

## The Learning page (`/t/:slug/learning`, sidebar)

- It shows in learning groups, in groups with a course you can see, and for teachers (`hasTeamLearning`).
- One call, `learning_overview`, returns three sections:
  - **teaching**: courses you lead (all of them for owners and admins), with students, average completion, not started, stuck 7+ days, finished, last activity and unused codes;
  - **learning**: courses you're enrolled in, with done/total and the next lesson;
  - **browse**: open courses you're not in.
- The page follows the collection view. Courses outside a collection show in every view.
- A course's **Members** tab, for its teachers and admins, has How students get in, Teachers and Course codes (`CourseEnrollmentPanel`, lazy).
- The course **Overview** shows the student's next lesson, or the teacher's shortcuts (`CourseOverviewLearning`, lazy).

## Public catalog (20261102100000_course_catalog)

- **Listing:** a course is a draft or published (`workspaces.published`), with a price in whole rupees (`price_inr`) and in US cents (`price_usd_cents`); empty means free.
  - The course's teachers set it on its Members tab (Public listing) through `set_course_listing`, unless the group keeps pricing to its owners and admins (`teams.teachers_set_prices`, in Group settings → Course catalog). Owners and admins can always change it.
  - Publishing needs a description (20+ characters) and at least one lesson.
- **Public pages** (lazy routes outside the app, no session needed):
  - `/learn/<group>` lists the published courses (`public_catalog`);
  - `/learn/<group>/<course>` shows one (`public_course`): description, outline (module and lesson titles only), teachers' names and pictures, price (₹ for visitors whose browser says India, $ otherwise: `visitorCurrency`).
  - Those functions are security definer, callable by anon, and return only those fields of published courses. A draft is shown only to people who can publish it, as a preview.
- **Joining:**
  - free courses: **Enroll free** → sign in (`?enroll=1` resumes) → `enroll_published_course` joins the group and the course;
  - paid courses: **Payments open soon**, plus a course code box (`join_with_code`; `?code=` survives the sign-in).
  - Checkout will replace "Payments open soon" by issuing a paid code.
- `/privacy` describes what a published course makes public.

## Tests

`psql "<dev or local URL>" -f supabase/tests/learning_platform.sql` runs 57 checks, covering:
- roles;
- creating courses;
- co-teachers;
- open and invite-only enrollment;
- codes (format, single use, joining the group, withdrawing, who reads them);
- a group invite through the same box;
- the Learning page's numbers per person;
- the catalog (who lists, publishing rules, what anon sees, draft previews, free enroll, paid needs a code, the pricing setting);
- demoting a teacher.

It rolls back. Run `supabase/tests/workspace_access.sql` too after touching access.

## Next

- Checkout, which issues paid codes.
- Exercises (assignments and submissions).
