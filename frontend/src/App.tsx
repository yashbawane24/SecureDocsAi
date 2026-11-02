import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';

// Public pages
import { Landing } from './pages/Landing';
import { RoleLogin, OpenSharedLink, LoginRedirect } from './pages/Login';
import { Signup } from './pages/Signup';
import { Join } from './pages/Join';
import { ForgotPassword } from './pages/ForgotPassword';

// Document Viewers
import { SecureViewer } from './pages/SecureViewer';

// Protected pages
import { Dashboard } from './pages/Dashboard';
import { Documents } from './pages/Documents';
import { DocumentDetailPage } from './pages/DocumentDetail';
import { SharedWithMe } from './pages/SharedWithMe';
import { SharedByMe } from './pages/SharedByMe';
import { NotificationsPage } from './pages/Notifications';
import { AuditLog } from './pages/AuditLog';
import { Members } from './pages/Members';
import { Invitations } from './pages/Invitations';
import { Approvals } from './pages/Approvals';
import { Departments } from './pages/Departments';
import { RolesPermissions } from './pages/RolesPermissions';
import { OrgSettings } from './pages/OrgSettings';
import { Profile } from './pages/Profile';
import { Security } from './pages/Security';
import { DemoInbox } from './pages/DemoInbox';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Product Landing & Role Sign-In Portals */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<RoleLogin portal="universal" />} />
          <Route path="/login/admin" element={<RoleLogin portal="admin" />} />
          <Route path="/login/head" element={<RoleLogin portal="head" />} />
          <Route path="/login/manager" element={<RoleLogin portal="manager" />} />
          <Route path="/login/employee" element={<RoleLogin portal="employee" />} />
          <Route path="/open" element={<OpenSharedLink />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/join" element={<Join />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* Secure Document Viewers */}
          <Route path="/viewer/:shareId" element={<SecureViewer />} />
          <Route path="/viewer/doc/:documentId" element={<SecureViewer />} />
          <Route path="/s/:token" element={<SecureViewer />} />
          <Route path="/share/:token" element={<SecureViewer />} />

          {/* Authenticated Application Layout */}
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/documents/:id" element={<DocumentDetailPage />} />
            <Route path="/risk-analysis" element={<Navigate to="/documents?view=risk" replace />} />
            <Route path="/shared-with-me" element={<SharedWithMe />} />
            <Route path="/shared-by-me" element={<SharedByMe />} />
            <Route path="/shared-links" element={<SharedByMe />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/audit-log" element={<AuditLog />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/demo-inbox" element={<DemoInbox />} />
            <Route path="/members" element={<Members />} />
            <Route path="/invitations" element={<Invitations />} />
            <Route path="/departments" element={<Departments />} />
            <Route path="/roles" element={<RolesPermissions />} />
            <Route path="/risk-policy" element={<Navigate to="/settings" replace />} />
            <Route path="/settings" element={<OrgSettings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/security" element={<Security />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};
