import { redirect } from 'next/navigation';

// 旧"福利兑换"入口已与"积分商店"合并为统一的"福利商店"，统一收口到 /store
export default function ProjectsRedirectPage() {
  redirect('/store');
}
