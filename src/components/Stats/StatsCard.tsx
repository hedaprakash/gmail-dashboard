interface StatsCardProps {
  label: string;
  value: number | string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'purple';
}

const colorClasses = {
  blue: 'text-blue-600 bg-blue-50 border-blue-200',
  green: 'text-green-600 bg-green-50 border-green-200',
  yellow: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  red: 'text-red-600 bg-red-50 border-red-200',
  gray: 'text-gray-600 bg-gray-50 border-gray-200',
  purple: 'text-purple-600 bg-purple-50 border-purple-200'
};

export default function StatsCard({ label, value, color = 'blue' }: StatsCardProps) {
  return (
    <div className={`rounded-lg border p-4 text-center ${colorClasses[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm opacity-75">{label}</div>
    </div>
  );
}
