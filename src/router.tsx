import { createBrowserRouter, Outlet, redirect } from 'react-router'
import { AuthLoading } from '@/features/auth/components/AuthLoading'
import { InactivityGuard } from '@/features/auth/components/InactivityGuard'
import { adminFeedbackLoader, adminFlagsLoader, adminGroupsLoader, adminLoader, adminOverviewLoader, adminUsersLoader } from '@/features/admin/loaders'
import { authCallbackLoader, loginLoader } from '@/features/auth/loaders'
import { watchAuthIdentity } from '@/features/auth/session'
import { diagramLoader } from '@/features/diagrams/loaders'
import { docLoader, filesLoader, filesShouldRevalidate } from '@/features/docs/loaders'
import { cycleLoader, issueLoader, issuesLoader } from '@/features/issues/loaders'
import { issueImportLoader, workspaceSettingsLoader } from '@/features/issues/import/loaders'
import { hubSettingsLoader, hubSprintsLoader, hubViewsLoader, issuesHubLoader, planLoader } from '@/features/issues/hub/loaders'
import { teamLearningLoader } from '@/features/learning/platformLoaders'
import { learningLoader, lessonLoader } from '@/features/learning/loaders'
import { liveSessionLoader } from '@/features/live/loaders'
import { githubCallbackLoader, githubTabLoader } from '@/features/repos/loaders'
import { appIndexLoader, onboardingLoader, teamLoader, teamMembersLoader, teamStartLoader, workspaceLoader } from '@/features/teams/loaders'
import { messagesLoader } from '@/features/messaging/loaders'
import { AppLayout } from '@/layouts/AppLayout'
import { APP_ROUTE_ID, appLoader } from '@/layouts/app-loader'
import { queryClient } from '@/lib/query-client'
import { DiagramPage } from '@/routes/DiagramPage'
import { DocPage } from '@/routes/DocPage'
import { MessagesPage } from '@/routes/team/MessagesPage'
import { FULL_BLEED } from '@/layouts/full-bleed'
import { NotFoundPage, RouteErrorPage } from '@/routes/NotFoundPage'
import { OnboardingPage } from '@/routes/OnboardingPage'
import { IssuesHubLayout } from '@/routes/team/IssuesHubLayout'
import { TeamLivePage } from '@/routes/team/TeamLivePage'
import { TeamMembersPage } from '@/routes/team/TeamMembersPage'
import { TeamWorkspacesPage } from '@/routes/team/TeamWorkspacesPage'
import { LessonPage } from '@/routes/workspace/LessonPage'
import { WorkspaceLearningPage } from '@/routes/workspace/WorkspaceLearningPage'
import { WorkspaceLivePage } from '@/routes/workspace/WorkspaceLivePage'
import { WorkspaceLayout } from '@/routes/workspace/WorkspaceLayout'
import { WorkspaceMembersPage } from '@/routes/workspace/WorkspaceMembersPage'
import { WorkspaceOverviewPage } from '@/routes/workspace/WorkspaceOverviewPage'
import { WorkspaceTabPage } from '@/routes/workspace/WorkspaceTabPage'
import { WorkspaceToolGate } from '@/routes/workspace/WorkspaceToolGate'
import { DiagramsRedirect } from '@/routes/DiagramsRedirect'
import { meetingCalendar } from '@/features/live/screens'

export const router = createBrowserRouter([
  { path: '/', loader: () => redirect('/app') },
  {
    path: '/login',
    loader: loginLoader,
    // Loaded on demand: signed-in people never download the sign-in page.
    lazy: async () => ({ Component: (await import('@/routes/LoginPage')).LoginPage }),
    hydrateFallbackElement: <AuthLoading />,
    errorElement: <RouteErrorPage />,
  },
  // Email + password for the admin account (testing without a Google round trip). Loaded on demand, linked from nowhere.
  {
    path: '/admin-login',
    loader: loginLoader,
    lazy: async () => ({ Component: (await import('@/routes/AdminLoginPage')).AdminLoginPage }),
    hydrateFallbackElement: <AuthLoading />,
    errorElement: <RouteErrorPage />,
  },
  // The public course catalog: an academy's published courses and one course's page, for anyone (no session
  // needed; a signed-in visitor's buttons change). Lazy; the loaders read through public functions only.
  {
    path: '/learn/:teamSlug',
    // Page and loader come in one lazy chunk: nothing of the catalog is in the app's first load.
    lazy: async () => {
      const learn = await import('@/routes/learn')
      return { Component: learn.CatalogPage, loader: learn.catalogLoader }
    },
    hydrateFallbackElement: <AuthLoading />,
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/learn/:teamSlug/:courseId',
    lazy: async () => {
      const learn = await import('@/routes/learn')
      return { Component: learn.PublicCoursePage, loader: learn.publicCourseLoader }
    },
    hydrateFallbackElement: <AuthLoading />,
    errorElement: <RouteErrorPage />,
  },
  // Public: no loader, so no session is needed (linked from Google's consent screen).
  { path: '/privacy', lazy: async () => ({ Component: (await import('@/routes/PrivacyPage')).PrivacyPage }), errorElement: <RouteErrorPage /> },
  {
    path: '/auth/callback',
    loader: authCallbackLoader, // always redirects
    element: <AuthLoading label="Signing you in…" />,
    hydrateFallbackElement: <AuthLoading label="Signing you in…" />,
    errorElement: <RouteErrorPage />,
  },
  {
    // Everything under here requires a session (appLoader → requireUser).
    id: APP_ROUTE_ID,
    loader: appLoader,
    element: (
      <>
        {/* Signs out a person who has been away too long (features/auth, lib/inactivity). */}
        <InactivityGuard />
        <Outlet />
      </>
    ),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <AuthLoading />,
    children: [
      // Redirects to the last/first team, or /onboarding when there are none.
      { path: 'app', loader: appIndexLoader, element: <AuthLoading /> },
      { path: 'onboarding', loader: onboardingLoader, element: <OnboardingPage /> },
      {
        // The platform admin console: counts, names and feature flags, outside every group. 404 for
        // anyone who isn't a platform admin (adminLoader); every read is checked again by the database.
        path: 'admin',
        loader: adminLoader,
        lazy: async () => ({ Component: (await import('@/routes/admin')).AdminLayout }),
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, loader: adminOverviewLoader, lazy: async () => ({ Component: (await import('@/routes/admin')).AdminOverviewPage }) },
          { path: 'groups', loader: adminGroupsLoader, lazy: async () => ({ Component: (await import('@/routes/admin')).AdminGroupsPage }) },
          { path: 'users', loader: adminUsersLoader, lazy: async () => ({ Component: (await import('@/routes/admin')).AdminUsersPage }) },
          { path: 'feedback', loader: adminFeedbackLoader, lazy: async () => ({ Component: (await import('@/routes/admin')).AdminFeedbackPage }) },
          { path: 'flags', loader: adminFlagsLoader, lazy: async () => ({ Component: (await import('@/routes/admin')).AdminFlagsPage }) },
        ],
      },
      // Back from installing the Calsko GitHub App (verified by the github Edge Function).
      {
        path: 'github/callback',
        loader: githubCallbackLoader,
        lazy: async () => ({ Component: (await import('@/routes/GitHubCallbackPage')).GitHubCallbackPage }),
        hydrateFallbackElement: <AuthLoading label="Connecting GitHub…" />,
      },
      {
        // Must be a team member (teamLoader). Renders the sidebar shell.
        path: 't/:teamSlug',
        loader: teamLoader,
        element: <AppLayout />,
        children: [
          {
            errorElement: <RouteErrorPage inline />,
            children: [
              { index: true, element: <TeamWorkspacesPage /> },
              // The open conversation's view (TipTap composer) starts downloading with the page, so it renders at once.
              { path: 'messages', handle: FULL_BLEED, loader: messagesLoader, element: <MessagesPage /> },
              // Where the group opens (after sign-in, or switching group or collection): its loader redirects.
              { path: 'start', loader: teamStartLoader },
              { path: 'members', loader: teamMembersLoader, element: <TeamMembersPage /> },
              { path: 'settings', lazy: async () => ({ Component: (await import('@/routes/team/TeamSettingsPage')).TeamSettingsPage }) },
              // Team → Files (URL docs): group-wide docs and diagrams + those of every workspace the user can see.
              // Lazy page; filesLoader starts its queries alongside the chunk.
              { path: 'docs', loader: filesLoader, shouldRevalidate: filesShouldRevalidate, lazy: async () => ({ Component: (await import('@/routes/team/TeamDocsPage')).TeamDocsPage }) },
              { path: 'docs/:docId', loader: docLoader, element: <DocPage /> },
              // The old Diagrams list opens Files showing diagrams; diagram pages keep their URLs.
              { path: 'diagrams', element: <DiagramsRedirect /> },
              // Full-bleed: the canvas takes the whole area under the top bar (DiagramView sets its height).
              { path: 'diagrams/:diagramId', loader: diagramLoader, handle: FULL_BLEED, element: <DiagramPage /> },
              // Learning (learning platform): Teaching, My learning and Browse courses, from one call.
              { path: 'learning', loader: teamLearningLoader, lazy: async () => ({ Component: (await import('@/routes/team/TeamLearningPage')).TeamLearningPage }) },
              {
                // The Issues hub (docs/ISSUES_HUB_PLAN.md): My issues, Plans, Sprints, Views. The layout checks the
                // group has issues; issuesHubLoader starts the group's issues, plans and people. Tabs are lazy.
                path: 'issues',
                loader: issuesHubLoader,
                element: <IssuesHubLayout />,
                children: [
                  { index: true, lazy: async () => ({ Component: (await import('@/routes/team/HubMyIssuesPage')).HubMyIssuesPage }) },
                  { path: 'plans', lazy: async () => ({ Component: (await import('@/routes/team/HubPlansPage')).HubPlansPage }) },
                  { path: 'plans/:planId', loader: planLoader, lazy: async () => ({ Component: (await import('@/routes/team/PlanPage')).PlanPage }) },
                  { path: 'sprints', loader: hubSprintsLoader, lazy: async () => ({ Component: (await import('@/routes/team/HubSprintsPage')).HubSprintsPage }) },
                  { path: 'views', loader: hubViewsLoader, lazy: async () => ({ Component: (await import('@/routes/team/HubViewsPage')).HubViewsPage }) },
                  // ⚙ Issue settings: importing (every few months) and who imported names are.
                  { path: 'settings', loader: hubSettingsLoader, lazy: async () => ({ Component: (await import('@/routes/team/HubSettingsPage')).HubSettingsPage }) },
                ],
              },
              // Group → Live: video sessions (Jitsi via JaaS) for the group and its workspaces.
              // The calendar (the default view) loads with the page, so it renders without waiting on its code.
              { path: 'live', loader: () => meetingCalendar.preload().then(() => null), element: <TeamLivePage /> },
              { path: 'live/:sessionId', loader: liveSessionLoader, lazy: async () => ({ Component: (await import('@/routes/LiveSessionPage')).LiveSessionPage }) },
              // Notes live in the header's panel; the old page's address (bookmarks, older notifications)
              // opens it on Chat, at the note it named.
              {
                path: 'reminders',
                loader: ({ params, request }) =>
                  // The path is spelled out: importing nav.ts here regroups the main chunk (+6 KB first load).
                  redirect(`/t/${params.teamSlug ?? ''}/messages?note=${new URL(request.url).searchParams.get('r') ?? 'open'}`),
              },
              {
                // Visible to team owners/admins and workspace members (workspaceLoader + RLS).
                path: 'w/:workspaceId',
                loader: workspaceLoader,
                element: <WorkspaceLayout />,
                children: [
                  { index: true, element: <WorkspaceOverviewPage /> },
                  { path: 'members', element: <WorkspaceMembersPage /> },
                  {
                    path: 'settings',
                    children: [
                      { index: true, loader: workspaceSettingsLoader, lazy: async () => ({ Component: (await import('@/routes/workspace/WorkspaceSettingsPage')).WorkspaceSettingsPage }) },
                      {
                        // Importing issues (Settings → Import): leads and group admins; its own chunk (CSV reading,
                        // Markdown conversion). Needs the Issues tool.
                        path: 'import',
                        loader: issueImportLoader,
                        element: <WorkspaceToolGate tool="issues" />,
                        children: [{ index: true, lazy: async () => ({ Component: (await import('@/routes/workspace/IssueImportPage')).IssueImportPage }) }],
                      },
                    ],
                  },
                  {
                    // Files (URL docs): this workspace's docs and diagrams; open when either tool is on.
                    path: 'docs',
                    element: <WorkspaceToolGate tool={['docs', 'diagrams']} />,
                    children: [
                      { index: true, loader: filesLoader, shouldRevalidate: filesShouldRevalidate, lazy: async () => ({ Component: (await import('@/routes/workspace/WorkspaceDocsPage')).WorkspaceDocsPage }) },
                      { element: <WorkspaceToolGate tool="docs" />, children: [{ path: ':docId', loader: docLoader, element: <DocPage /> }] },
                    ],
                  },
                  {
                    // This workspace's diagrams; the list itself is Files.
                    path: 'diagrams',
                    element: <WorkspaceToolGate tool="diagrams" />,
                    children: [
                      { index: true, element: <DiagramsRedirect /> },
                      { path: ':diagramId', loader: diagramLoader, handle: FULL_BLEED, element: <DiagramPage /> },
                    ],
                  },
                  {
                    // Linear-style issues (workspace-only).
                    path: 'issues',
                    // Starts all the data the Issues pages need at once (see issuesLoader).
                    loader: issuesLoader,
                    element: <WorkspaceToolGate tool="issues" />,
                    children: [
                      { index: true, lazy: async () => ({ Component: (await import('@/routes/workspace/WorkspaceIssuesPage')).WorkspaceIssuesPage }) },
                      { path: 'cycles', lazy: async () => ({ Component: (await import('@/routes/workspace/IssueCyclesPage')).IssueCyclesPage }) },
                      { path: 'cycles/:cycleNumber', loader: cycleLoader, lazy: async () => ({ Component: (await import('@/routes/workspace/IssueCyclePage')).IssueCyclePage }) },
                      { path: ':issueNumber', loader: issueLoader, lazy: async () => ({ Component: (await import('@/routes/workspace/IssuePage')).IssuePage }) },
                    ],
                  },
                  {
                    // Course outline, lessons and class progress.
                    path: 'learning',
                    loader: learningLoader,
                    element: <WorkspaceToolGate tool="learning" />,
                    children: [
                      { index: true, element: <WorkspaceLearningPage /> },
                      { path: 'progress', lazy: async () => ({ Component: (await import('@/routes/workspace/LearningProgressPage')).LearningProgressPage }) },
                      { path: ':lessonId', loader: lessonLoader, element: <LessonPage /> },
                    ],
                  },
                  {
                    // Only this workspace's live sessions.
                    path: 'live',
                    element: <WorkspaceToolGate tool="live" />,
                    children: [
                      { index: true, loader: () => meetingCalendar.preload().then(() => null), element: <WorkspaceLivePage /> },
                      { path: ':sessionId', loader: liveSessionLoader, lazy: async () => ({ Component: (await import('@/routes/LiveSessionPage')).LiveSessionPage }) },
                    ],
                  },
                  {
                    // The repos linked to this project (group repos; issues point at them).
                    path: 'github',
                    loader: githubTabLoader,
                    element: <WorkspaceToolGate tool="github" />,
                    children: [{ index: true, lazy: async () => ({ Component: (await import('@/routes/workspace/WorkspaceGitHubPage')).WorkspaceGitHubPage }) }],
                  },
                  // Feature tabs that don't exist yet (Exercises); checked against the enabled tools.
                  { path: ':tab', element: <WorkspaceTabPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])

// Signed in/out elsewhere (another tab, expired session): drop cached data from
// the previous identity and re-run loaders, which redirect as needed.
watchAuthIdentity((userId) => {
  if (userId) {
    queryClient.clear()
    void router.revalidate()
    return
  }
  // Signed out: leave the page first (its loaders send it to /login), then drop the data. Cleared while
  // the page is still up, every query on it refetched without a session and failed as "permission denied".
  void router.revalidate().finally(() => queryClient.clear())
})
