"use client";

import AdminView from "@/components/AdminView";

export default function AdminPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { token?: string };
}) {
  const token = searchParams?.token ?? "";
  if (!token) {
    return <div className="p-6 text-red-600">Missing admin token. Open this page using your private admin link.</div>;
  }
  return <AdminView id={params.id} token={token} />;
}
