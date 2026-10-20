import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { passcode } = await req.json();
    
    // Accept either APP_PASSCODE or APP_PASSWORD
    const rawPasscode = 
      process.env.APP_PASSCODE || 
      process.env.APP_PASSWORD || 
      "1234";

    const serverPasscode = rawPasscode.replace(/^["']|["']$/g, "").trim();

    // Log diagnostic check in Vercel runtime logs (without exposing full secret)
    console.log(`[Auth Check] Env var loaded: ${serverPasscode !== "1234" ? "Custom Passcode Active" : "Default 1234 Fallback"}`);

    if (passcode && passcode.toString().trim() === serverPasscode) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Incorrect passcode" }, { status: 401 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
