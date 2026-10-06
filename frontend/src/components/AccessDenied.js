import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

const AccessDenied = () => (
  <div className="flex min-h-[60vh] items-center justify-center px-4">
    <div className="max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
        <ShieldAlert className="h-7 w-7" />
      </div>
      <h2 className="mb-2 text-2xl font-semibold text-foreground">Access Denied</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        You do not have permission to view this page. Contact your administrator to request access.
      </p>
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <ArrowLeft className="h-4 w-4" />
        Go to Dashboard
      </Link>
    </div>
  </div>
);

export default AccessDenied;
