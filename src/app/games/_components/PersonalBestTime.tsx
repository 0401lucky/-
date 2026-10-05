interface PersonalBestTimeProps {
  duration?: number;
  loaded: boolean;
}

export function PersonalBestTime({ duration, loaded }: PersonalBestTimeProps) {
  let label = loaded ? '暂无通关纪录' : '—';
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    const seconds = Math.ceil(duration / 1000);
    label = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return <span>个人最快：{label}</span>;
}
