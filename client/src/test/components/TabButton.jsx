export default function TabButton({ id, label, icon: Icon, activeTab, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-t-lg border-t border-l border-r transition-all relative top-[1px] ${
        activeTab === id
          ? 'bg-white text-blue-700 border-gray-300 z-10 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]'
          : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
