import { auth } from '@/lib/supabase/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { email, password } = await request.json();
  try {
    const { data, error } = await auth.signIn(email, password);
    if (error) throw error;
    return NextResponse.json(data, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Failed to sign in' }, { status: 401 });
  }
}
