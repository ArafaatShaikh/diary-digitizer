import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { passcode } = await req.json();
    
    // Strip accidental quotes or surrounding spaces from Vercel UI
    const rawPasscode = process.env.APP_PASSCODE || "1234";
    const serverPasscode = rawPasscode.replace(/^["']|["']$/g, "").trim();

    if (passcode && passcode.toString().trim() === serverPasscode) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Incorrect passcode" }, { status: 401 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
