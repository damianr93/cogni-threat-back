import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';
import 'dotenv/config';

const apiId = parseInt(process.env.TELEGRAM_API_ID || '');
const apiHash = process.env.TELEGRAM_API_HASH || '';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const input = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function authenticate() {
  console.log('\n🔐 Autenticación de Telegram para monitoreo de canales\n');
  
  if (!apiId || !apiHash) {
    console.error('❌ Error: TELEGRAM_API_ID y TELEGRAM_API_HASH deben estar configurados en .env');
    console.log('Obtén tus credenciales en: https://my.telegram.org\n');
    process.exit(1);
  }

  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input('📱 Número de teléfono (ej: +5491234567890): '),
    password: async () => await input('🔒 Contraseña 2FA (presiona Enter si no tienes): '),
    phoneCode: async () => await input('💬 Código recibido por Telegram: '),
    onError: (err) => console.error('❌ Error:', err),
  });

  console.log('\n✅ Autenticación exitosa!\n');
  console.log('📝 Agrega esta línea a tu .env:\n');
  console.log('─'.repeat(80));
  console.log(`TELEGRAM_SESSION_STRING=${client.session.save()}`);
  console.log('─'.repeat(80));
  console.log('\n');

  await client.disconnect();
  rl.close();
  process.exit(0);
}

authenticate().catch((err) => {
  console.error('\n❌ Error durante la autenticación:', err.message);
  rl.close();
  process.exit(1);
});

