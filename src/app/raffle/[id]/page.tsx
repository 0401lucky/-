import { redirect } from 'next/navigation';

// 多人抽奖独立详情页已并入 /project/[id]?type=raffle 福利项目详情页
export default async function RaffleDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/project/${id}?type=raffle`);
}
