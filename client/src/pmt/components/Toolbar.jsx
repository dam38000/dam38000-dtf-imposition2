import { Icons } from './Icons';

const PRESETS_MAP = {
  '980x575': '1M', '575x980': '1M',
  '575x420': 'A2', '420x575': 'A2',
  '420x280': 'A3', '280x420': 'A3',
  '280x202': 'A4', '202x280': 'A4',
  '202x132': 'A5', '132x202': 'A5',
  '132x100': 'A6', '100x132': 'A6',
};

export default function Toolbar({ sheetSize, sheets, stats, onExportDessin, onExportCoupe, onExportComposite, isExporting }) {
  const formatKey = `${parseInt(sheetSize.w)}x${parseInt(sheetSize.h)}`;
  const currentFormat = PRESETS_MAP[formatKey] || null;
  const canExport = sheets.length > 0 && !isExporting;

  return (
    <div className="h-[220px] bg-white border-b border-gray-300 flex shadow-sm z-10">
      {/* Colonne 1 : Tirage + exports */}
      <div className="w-[180px] border-r border-gray-200 flex flex-col items-center justify-center p-3 bg-gray-50 flex-shrink-0">
        <a href="/" className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded shadow transition-colors no-underline text-center block">Accueil</a>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-4xl font-bold text-blue-600">{stats.totalSheets}</span>
          <span className="text-xs text-gray-500">exemplaires</span>
        </div>
        {currentFormat && <span className="mt-0.5 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">{currentFormat}</span>}
        <div className="flex flex-col gap-1.5 mt-2 w-full">
          <div className="flex gap-1">
            <button
              onClick={onExportDessin}
              disabled={!canExport}
              className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-colors ${canExport ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              {isExporting === 'dessin' ? <Icons.Loader size={10} className="animate-spin" /> : <Icons.Layout size={10}/>} Dessin
            </button>
            <button
              onClick={onExportCoupe}
              disabled={!canExport}
              className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-colors ${canExport ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              {isExporting === 'coupe' ? <Icons.Loader size={10} className="animate-spin" /> : <Icons.Scissors size={10}/>} Coupe
            </button>
          </div>
          <button
            onClick={onExportComposite}
            disabled={!canExport}
            className={`w-full py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-colors ${canExport ? 'bg-gray-700 hover:bg-gray-800 text-white shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            {isExporting === 'composite' ? <Icons.Loader size={10} className="animate-spin" /> : <Icons.Layers size={10}/>} Composite
          </button>
        </div>
      </div>

      {/* Colonne 2 : Panneau Prix */}
      <div className="w-[310px] flex-shrink-0 border-r border-gray-200 bg-white p-3 flex flex-col justify-between overflow-hidden">
        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Devis</div>
        <div className="flex-1 flex items-center justify-center text-[10px] text-gray-400 italic text-center px-2">
          Lancez le montage pour calculer le prix
        </div>
        <div className="mt-1.5 flex gap-1">
          <input type="text" placeholder="Code promo" className="flex-1 border border-gray-300 rounded px-2 text-[10px] h-6 focus:outline-none focus:border-purple-400" disabled />
          <button className="px-2 h-6 bg-purple-600 hover:bg-purple-700 text-white rounded text-[9px] font-bold transition-colors opacity-50 cursor-not-allowed" disabled>OK</button>
        </div>
      </div>

      {/* Colonne 3 : Bouton Panier + détails */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 pt-2 pb-1.5 border-b border-gray-100 flex-shrink-0">
          <button disabled className="w-full h-9 rounded-lg flex items-center justify-center gap-2 font-bold text-sm bg-gray-200 text-gray-400 cursor-not-allowed">
            Ajouter au panier
          </button>
        </div>
        <div className="flex-1 p-2 overflow-hidden">
          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto h-full content-start pr-0.5">
            {stats.details.map((item, idx) => (
              <div key={idx} className={`bg-white border rounded p-1.5 flex gap-1.5 shadow-sm h-[52px] items-center ${item.made >= item.req ? 'border-green-200' : 'border-gray-200'}`}>
                <div className="w-8 h-8 bg-gray-100 border rounded overflow-hidden flex-shrink-0">
                  <img src={item.src} className="w-full h-full object-contain"/>
                </div>
                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <div className="text-[9px] font-bold truncate text-gray-900" title={item.name}>{item.name}</div>
                  <div className="text-[8px] text-gray-600 flex justify-between">
                    <span>{item.req} cmd</span>
                    <span className="font-bold">{item.made} fab</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-0.5 mt-0.5">
                    <div className={`h-0.5 rounded-full ${item.made >= item.req ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100,(item.made/item.req)*100)}%` }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
