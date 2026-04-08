import Toolbar from './Toolbar';
import SheetView from './SheetView';

export default function MainArea({
  sheetSize, sheets, setSheets, hasCalculated, errors, setErrors, stats,
  activeTab, setActiveTab, impositionMode, margin, simulatePrint,
  dragState, setDragState,
  onExportDessin, onExportCoupe, onExportComposite, isExporting,
}) {
  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden">
      <Toolbar sheetSize={sheetSize} sheets={sheets} stats={stats} onExportDessin={onExportDessin} onExportCoupe={onExportCoupe} onExportComposite={onExportComposite} isExporting={isExporting} />
      <SheetView
        sheets={sheets}
        setSheets={setSheets}
        hasCalculated={hasCalculated}
        errors={errors}
        setErrors={setErrors}
        sheetSize={sheetSize}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        impositionMode={impositionMode}
        margin={margin}
        simulatePrint={simulatePrint}
        dragState={dragState}
        setDragState={setDragState}
      />
    </main>
  );
}
