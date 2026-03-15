import { Icons } from './Icons';

export default function FileList({ files, onRemove, onRemoveAll, onUpdateQuantity, simulatePrint }) {
  return (
    <div className="flex-1 overflow-y-auto bg-white p-3 space-y-3 relative pb-6">
      {files.length > 0 && (
        <div className="flex justify-between items-center mb-1 px-1">
          <span className="text-[10px] font-bold text-gray-500 uppercase">{files.length} Fichiers</span>
          <div className="flex gap-2">
            <button onClick={onRemoveAll} className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1 font-bold transition-colors">
              <Icons.Trash size={10} /> TOUT EFFACER
            </button>
          </div>
        </div>
      )}

      {files.map(file => (
        <div key={file.id} className="bg-gray-50 border border-gray-200 rounded p-2 flex gap-3 relative group hover:shadow-md transition-shadow">
          <div className="w-16 h-16 bg-white border border-gray-200 rounded flex items-center justify-center overflow-hidden flex-shrink-0 relative">
            <img
              src={file.thumbnailUrl}
              alt="mini"
              className={`max-w-full max-h-full object-contain ${simulatePrint ? 'print-simulated' : ''}`}
            />
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <div className="flex justify-between items-start gap-1">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                <span className="text-xs font-bold text-gray-900 truncate" title={file.name}>{file.name}</span>
              </div>
              <button onClick={() => onRemove(file.id)} className="text-red-400 hover:text-red-600 flex-shrink-0 ml-1">
                <Icons.X size={18}/>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 items-end mt-2">
              <div className="flex flex-col">
                <span className="text-[9px] text-gray-600 uppercase">Larg.</span>
                <input type="text" className="w-full border rounded px-1 text-xs bg-gray-100 text-gray-500 h-6 cursor-not-allowed" value={file.width_mm} readOnly />
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] text-gray-600 uppercase">Haut.</span>
                <input type="text" className="w-full border rounded px-1 text-xs bg-gray-100 text-gray-500 h-6 cursor-not-allowed" value={file.height_mm} readOnly />
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] text-gray-600 uppercase">Qté</span>
                <div className="flex items-center border rounded bg-white h-6">
                  <input
                    type="number"
                    min="0"
                    className="w-full px-1 text-xs outline-none"
                    value={file.quantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => onUpdateQuantity(file.id, Math.abs(parseInt(e.target.value)) || 0)}
                  />
                  <div className="flex flex-col border-l h-full">
                    <button onClick={() => onUpdateQuantity(file.id, file.quantity + 1)} className="px-1 hover:bg-gray-100 text-[8px] flex-1 flex items-center"><Icons.ArrowUp/></button>
                    <button onClick={() => onUpdateQuantity(file.id, Math.max(0, file.quantity - 1))} className="px-1 hover:bg-gray-100 text-[8px] border-t flex-1 flex items-center"><Icons.ArrowDown/></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
