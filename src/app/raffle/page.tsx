import { redirect } from 'next/navigation';

// 多人抽奖独立列表页已并入"福利商店"，统一收口到 /store
export default function RaffleRedirectPage() {
  redirect('/store');
}
