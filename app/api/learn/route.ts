// Legacy clients must sign in; correction-derived profiles are now edited by the user.
import { requireUser, apiError } from "@/lib/server-auth";
export async function POST(request: Request) {
  try {
    await requireUser(request);
    return Response.json(
      {
        error:
          "Automatic handwriting learning has been replaced with editable personal vocabulary.",
      },
      { status: 410 },
    );
  } catch (error) {
    return apiError(error);
  }
}
