import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { LogoMark, LogoWordmark } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'

const UPDATED = 'November 1, 2026'

/**
 * Public privacy policy at /privacy (no sign-in needed; linked from the login
 * page and from Google's consent screen). Keep it in step with what the app
 * actually stores; see docs/STATUS.md.
 */
export function PrivacyPage() {
  return (
    <div className="min-h-svh bg-background">
      <header className="flex items-center justify-between px-4 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Calsko home">
          <LogoMark className="h-8" />
          <LogoWordmark className="h-5" />
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6 pb-20 md:px-8">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">Last updated {UPDATED}</p>

        <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
          Calsko is a private workspace for learning and teaching software engineering, used by an instructor and a
          small group of students. This page explains what Calsko stores about you and why.
        </p>

        <Section title="What we get when you sign in with Google, Microsoft or GitHub">
          <p>When you sign in with Google, Microsoft or GitHub, Calsko receives and stores:</p>
          <ul>
            <li>your name (or, on GitHub, your username when your profile has no name),</li>
            <li>your email address,</li>
            <li>a link to your Google or GitHub profile photo (Microsoft doesn’t share one), shown as your avatar to people in your group.</li>
          </ul>
          <p>
            Calsko never sees your Google, Microsoft or GitHub password and has no access to your email, files, calendar,
            repositories or anything else in those accounts.
          </p>
        </Section>

        <Section title="What you create in Calsko">
          <p>Calsko stores the things you and your group create, so you can use them:</p>
          <ul>
            <li>groups, workspaces and who belongs to them, with their roles;</li>
            <li>docs (including images you add to them) and whiteboards;</li>
            <li>issues (including images you add to their descriptions), comments, labels, sprints and plans, a history of changes made to issues, and what you star;</li>
            <li>
              issues imported from a file (for example an export from Linear, Notion or Jira): what the file says about each
              issue, including the name or email of its assignee when that person isn’t in Calsko, kept until a project lead
              matches it to someone;
            </li>
            <li>the GitHub repositories your group uses (their names and GitHub ids) and which projects use them;</li>
            <li>notes you keep for yourself: their title, details, the time you want them to pop up (if any) and the workspace or issue they are about;</li>
            <li>
              feedback you send with Send feedback in your profile menu: what you wrote, its kind, the page you were on, your group, and
              your browser, window size and light or dark theme. Only the people who run Calsko read it, not your group.
            </li>
          </ul>
          <p>
            This content is only visible to people in your group or workspace, according to their role (for example,
            workspace content is visible to that workspace’s members and the group’s owners and admins). Notes are
            the exception: only you can see yours, not even the group’s owners and admins.
          </p>
        </Section>

        <Section title="If your group connects GitHub">
          <p>
            A group owner or admin can connect the Calsko GitHub app. On GitHub, they choose which repositories it may
            see, and Calsko can only reach those. Calsko stores the GitHub account or organization it was installed
            on.
          </p>
          <p>
            While connecting, GitHub asks the person connecting to sign in, so Calsko can check they really have access
            to that installation. Calsko uses that GitHub sign-in once and doesn’t keep it.
          </p>
        </Section>

        <Section title="If your project connects an error tracker">
          <p>
            A project lead or a group owner or admin can connect an error tracker, such as PostHog, or a webhook that
            other tools send errors to. Once a day Calsko collects the errors it reports and keeps, for each kind of
            error: its message and stack trace, the page and browser it happened in, how many times it happened each
            day, and a link back to the tracker. A new kind of error becomes an issue in the project, which everyone in
            the project can read like any other issue.
          </p>
          <p>
            Calsko keeps the tracker’s API key encrypted and a webhook’s token only as a fingerprint, and never shows
            either again. Removing the source deletes them and the error counts; the issues it made stay.
          </p>
          <p>
            If your group has AI-written error issues switched on, the error (message, stack trace, page, browser and
            counts) is sent to Google’s Gemini model once per new issue, to write its title and description, under the
            same terms as Calsko AI below. Errors can contain whatever your app put in them, so keep personal data and
            secrets out of error messages.
          </p>
        </Section>

        <Section title="If you use Calsko AI">
          <p>
            Calsko AI lets you type a request in your own words, such as “show my open issues” or “tell Sree I’ll be
            late”. It is only used when you open it and send something. To answer, Calsko sends to an AI model run by
            Google (Gemini):
          </p>
          <ul>
            <li>what you typed, and the last few messages of that Calsko AI chat;</li>
            <li>your name, your group’s name, the date and your time zone, and the name of the page you have open;</li>
            <li>
              the Calsko details needed for that one request, for example the titles and status of matching issues, the
              names of people in your group, or the title and time of a meeting.
            </li>
          </ul>
          <p>
            It can only see and do what you are allowed to see and do, and it asks you before sending a message.
            Calsko does not send your email address, your sign-in, your documents or your chat history to the model,
            and the chat itself lives only in your browser tab until you close it. Calsko does keep a private record of
            each request you send: what you typed, the steps it took in Calsko to answer (which actions it ran and
            with what details), and its reply. It is there so a wrong answer can be traced and fixed; only you can read
            it, other people in your group can’t, and it is kept until your account or group is deleted. A message you ask it to prepare is held for up to ten minutes while it waits for your confirmation.
          </p>
          <p>
            Google processes these requests under the terms of its paid Gemini API, under which Google doesn’t use
            them to improve its products.
          </p>
        </Section>

        <Section title="In your browser">
          <p>
            Calsko keeps your sign-in session and a few preferences in your browser: light or dark theme, the last
            group you opened, whether some panels are open, and your Calsko AI conversation in each group (until you
            start a new chat). The session stays in the tab you signed in with and
            ends after 4 hours; if you tick “Remember me”, this browser keeps it for up to 12 hours. Either way you are
            signed out after 15 minutes without use. There are no ads, no analytics and no tracking.
          </p>
        </Section>

        <Section title="Who handles your data">
          <p>Calsko runs on a few services that store or process data on its behalf:</p>
          <ul>
            <li>
              <strong>Supabase</strong>: database, sign-in and file storage;
            </li>
            <li>
              <strong>Vercel</strong>: hosts the website;
            </li>
            <li>
              <strong>Google</strong>: the “Sign in with Google” step, and the AI model behind Calsko AI when you use
              it;
            </li>
            <li>
              <strong>Resend</strong>: sends Calsko’s emails: group invites, your note reminders, meeting invites and
              changes, and feedback to the people who read it. Your address and the email’s content are passed on to
              deliver it. You can turn reminder and meeting emails off from your name in the sidebar → Email;
            </li>
            <li>
              <strong>PostHog</strong>: page views and error reports. Each page you open in Calsko is recorded (its
              address, when, the page you came from, and your browser, device and rough location), so we can see
              which parts get used. When something breaks, the technical details of the error are sent so it can be
              fixed. Both carry your user id, not your name or email. Clicks, typing and what you write are not
              tracked, and nothing is stored in cookies;
            </li>
            <li>
              <strong>Microsoft</strong>: the “Continue with Microsoft” step, if you use it;
            </li>
            <li>
              <strong>GitHub</strong>: the “Continue with GitHub” step, if you use it; and, only if your group connects it, the
              repositories it was given access to.
            </li>
          </ul>
          <p>
            Your data is <strong>never sold</strong>, and it isn’t shared with advertisers or anyone else.
          </p>
        </Section>

        <Section title="Keeping and deleting data">
          <p>
            Your data is kept while you use Calsko. Group owners and workspace leads can delete content, and leaving a
            group removes your access to it and deletes your notes in it. To have your account and data deleted, ask the instructor who runs your
            Calsko group.
          </p>
        </Section>

        <Section title="Changes">
          <p>If this policy changes, this page will be updated and the date above will change.</p>
        </Section>

        <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          <Link to="/login" className="underline underline-offset-4 hover:text-foreground">
            Back to sign in
          </Link>
        </p>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  )
}
