export async function POST() {
  return Response.json(
    {
      error:
        "Shared passcodes are no longer supported. Sign in with your own account.",
    },
    { status: 410 },
  );
}
