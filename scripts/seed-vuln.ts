/**
 * Seed inicial del Vuln Monitor.
 * Corre: npx ts-node scripts/seed-vuln.ts
 *
 * NVD:    últimos 90 días
 * KEV:    catálogo completo
 * GitHub: últimos 90 días
 * OSV:    todos los IDs del modified_id.csv
 * EPSS:   CSV del día
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { KevCollector } from '../src/modules/vuln-monitor/collectors/kev.collector';
import { NvdCollector } from '../src/modules/vuln-monitor/collectors/nvd.collector';
import { GithubAdvisoryCollector } from '../src/modules/vuln-monitor/collectors/github-advisory.collector';
import { OsvCollector } from '../src/modules/vuln-monitor/collectors/osv.collector';
import { EpssCollector } from '../src/modules/vuln-monitor/collectors/epss.collector';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });

  const nvd = app.get(NvdCollector);
  const kev = app.get(KevCollector);
  const github = app.get(GithubAdvisoryCollector);
  const osv = app.get(OsvCollector);
  const epss = app.get(EpssCollector);

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  console.log('=== Vuln Monitor Seed ===');

  console.log('\n[1/5] KEV — catálogo completo...');
  const kevResult = await kev.sync();
  console.log(`KEV: new=${kevResult.newItems} updated=${kevResult.updatedItems} errors=${kevResult.errors.length}`);

  console.log('\n[2/5] NVD — últimos 90 días...');
  const nvdResult = await nvd.sync(ninetyDaysAgo);
  console.log(`NVD: new=${nvdResult.newItems} updated=${nvdResult.updatedItems} errors=${nvdResult.errors.length}`);

  console.log('\n[3/5] GitHub Advisory — últimos 90 días...');
  const ghResult = await github.sync(ninetyDaysAgo);
  console.log(`GitHub: new=${ghResult.newItems} updated=${ghResult.updatedItems} errors=${ghResult.errors.length}`);

  console.log('\n[4/5] OSV — todos los IDs...');
  const osvResult = await osv.sync(null as any);
  console.log(`OSV: new=${osvResult.newItems} updated=${osvResult.updatedItems} errors=${osvResult.errors.length}`);

  console.log('\n[5/5] EPSS — CSV del día...');
  const epssResult = await epss.sync();
  console.log(`EPSS: updated=${epssResult.updatedItems} errors=${epssResult.errors.length}`);

  console.log('\n✅ Seed completado');
  await app.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
