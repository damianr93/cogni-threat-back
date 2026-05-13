import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface FakeNewsItem {
  origin: string;
  target?: string;
  methods?: string;
  consequences: string[];
  links: string[];
}

async function ingestFakeNews() {
  try {
    console.log('🚀 Iniciando ingesta de Fake News...\n');

    // Leer el archivo JSON
    const jsonPath = path.join(__dirname, 'deepfake_database.json');
    const jsonData = fs.readFileSync(jsonPath, 'utf-8');
    const fakeNewsData: FakeNewsItem[] = JSON.parse(jsonData);

    console.log(`📊 Total de registros a ingerir: ${fakeNewsData.length}\n`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Procesar cada registro
    for (let i = 0; i < fakeNewsData.length; i++) {
      const item = fakeNewsData[i];
      
      try {
        // Verificar si ya existe un registro con el mismo origin (para evitar duplicados)
        const existing = await prisma.fakeNewsData.findFirst({
          where: {
            origin: item.origin,
          },
        });

        if (existing) {
          console.log(`⏭️  [${i + 1}/${fakeNewsData.length}] Saltado (ya existe): ${item.origin.substring(0, 50)}...`);
          skippedCount++;
          continue;
        }

        // Crear el registro
        // Usar origin como título si no hay título específico
        const title = item.origin.length > 100 ? item.origin.substring(0, 100) + '...' : item.origin;
        
        const fakeNews = await prisma.fakeNewsData.create({
          data: {
            title: title,
            origin: item.origin,
            target: item.target || null,
            methods: item.methods || null,
            consequences: item.consequences || [],
            links: item.links || [],
          },
        });

        console.log(`✅ [${i + 1}/${fakeNewsData.length}] Creado: ${item.origin.substring(0, 50)}...`);
        successCount++;
      } catch (error: any) {
        console.error(`❌ [${i + 1}/${fakeNewsData.length}] Error: ${item.origin.substring(0, 50)}...`);
        console.error(`   ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n📈 Resumen:');
    console.log(`   ✅ Exitosos: ${successCount}`);
    console.log(`   ⏭️  Saltados: ${skippedCount}`);
    console.log(`   ❌ Errores: ${errorCount}`);
    console.log(`   📊 Total procesado: ${fakeNewsData.length}\n`);

    console.log('✨ Ingesta completada!\n');
  } catch (error: any) {
    console.error('❌ Error fatal durante la ingesta:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar la ingesta
ingestFakeNews()
  .catch((error) => {
    console.error('❌ Error no manejado:', error);
    process.exit(1);
  });

