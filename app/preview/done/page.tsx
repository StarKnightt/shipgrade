export default async function PreviewDone({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { cancelled } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center p-8 text-center">
      <div>
        <h1 className="font-serif text-2xl font-semibold">
          {cancelled ? "Checkout cancelled." : "Payment approved in the PayPal sandbox."}
        </h1>
        <p className="mt-2 text-sm text-muted">You can close this tab and return to your Shipgrade report.</p>
      </div>
    </main>
  );
}
