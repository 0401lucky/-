import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getUserCardData } from '@/lib/cards/draw';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getAuthUser();
    
    if (!user) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const cardData = await getUserCardData(user.id.toString());
    
    return NextResponse.json({
      success: true,
      data: cardData
    });
  } catch (error) {
    console.error('Failed to fetch card inventory:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
