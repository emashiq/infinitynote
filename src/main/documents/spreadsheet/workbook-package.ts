import type { WorkbookFeature } from '../../../shared/documents/workbook';
import { openOoxml } from '../ooxml-package';

/** Package parts that hold what the workbook model does not carry (D-136); ExcelJS drops them on save. */
const PART_FEATURES: ReadonlyArray<{ part: RegExp; feature: WorkbookFeature }> = [
  { part: /^xl\/charts\//, feature: 'charts' },
  { part: /^xl\/(pivotTables|pivotCache)\//, feature: 'pivotTables' },
  { part: /^xl\/media\//, feature: 'images' },
  { part: /^xl\/tables\//, feature: 'tables' },
  { part: /^xl\/externalLinks\//, feature: 'externalLinks' },
  { part: /^xl\/(ctrlProps|activeX)\//, feature: 'formControls' },
  { part: /^xl\/(slicers|slicerCaches|timelines|timelineCaches)\//, feature: 'slicers' },
];

/** The features an xlsx package shows by its part names; the worker adds the ones inside sheets. */
export async function packageFeatures(file: string): Promise<WorkbookFeature[]> {
  const archive = await openOoxml(file, 'xlsx');
  if (!archive) return [];
  try {
    const names = [...archive.names];
    return PART_FEATURES.filter(({ part }) => names.some((name) => part.test(name))).map(({ feature }) => feature);
  } finally {
    archive.close();
  }
}
