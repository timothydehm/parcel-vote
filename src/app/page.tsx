import CreateForm from "@/components/CreateForm";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">Parcel Pulse</h1>
      <p className="mt-1 text-slate-600">
        Ask one question. Share a link. Watch the map fill in with people&rsquo;s answers.
      </p>
      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <CreateForm />
      </div>
    </main>
  );
}
