import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { passcode } = await req.json();
    
    // Read from Vercel if present; otherwise default directly to your passcode
    const envPass = (process.env.APP_PASSCODE || process.env.APP_PASSWORD || "")
      .replace(/^["']|["']$/g, "")
      .trim();

    const serverPasscode = envPass || "sumaislam1710";

    if (passcode && passcode.toString().trim() === serverPasscode) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Incorrect passcode" }, { status: 401 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
