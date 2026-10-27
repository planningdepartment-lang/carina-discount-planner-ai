import { Env } from '../config/env';
import { generateOdooPOSPricelistCSV } from '../engine/posExporter';
import { getOrComputeStylePlan } from './styleService';

export async function handleExportPosCsv(
  request: Request, 
  env: Env, 
  corsHeaders: Record<string, string>
): Promise<Response> {
  const records = await getOrComputeStylePlan(env.DB);
  const csv = generateOdooPOSPricelistCSV(records);
  return new Response(csv, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="Odoo_POS_Promotional_Pricelist.csv"'
    }
  });
}
