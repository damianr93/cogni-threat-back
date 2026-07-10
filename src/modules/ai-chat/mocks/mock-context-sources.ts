import { ContextSourceItem } from '../types/chat.types';

export const MOCK_CONTEXT_SOURCES: ContextSourceItem[] = [
  {
    id: 'ransomware:lockbit-victim-001',
    label: 'LockBit — acme-corp.com',
    category: 'ransomware',
    summary: 'Víctima publicada en ransomware.live',
  },
  {
    id: 'ransomware:alphv-sector-002',
    label: 'ALPHV — sector salud EU',
    category: 'ransomware',
    summary: 'Grupo activo, múltiples víctimas',
  },
  {
    id: 'ransomware:cl0p-moveit-003',
    label: 'Cl0p — MoveIT campaign',
    category: 'ransomware',
    summary: 'Campaña masiva 2023-2024',
  },
  {
    id: 'vuln-monitor:cve-2024-3400',
    label: 'CVE-2024-3400',
    category: 'vuln-monitor',
    summary: 'PAN-OS command injection — KEV',
  },
  {
    id: 'vuln-monitor:cve-2023-4966',
    label: 'CVE-2023-4966',
    category: 'vuln-monitor',
    summary: 'Citrix Bleed — explotación activa',
  },
  {
    id: 'vuln-monitor:cve-2024-21762',
    label: 'CVE-2024-21762',
    category: 'vuln-monitor',
    summary: 'FortiOS SSL VPN OOB write',
  },
  {
    id: 'actors:apt29-cozy',
    label: 'APT29 / Cozy Bear',
    category: 'actors',
    summary: 'Espionaje, sector gobierno',
  },
  {
    id: 'actors:lazarus-dprk',
    label: 'Lazarus Group',
    category: 'actors',
    summary: 'Financiero, cripto',
  },
  {
    id: 'actors:lockbit-affiliate',
    label: 'LockBit affiliate T1566',
    category: 'actors',
    summary: 'Phishing inicial',
  },
  {
    id: 'telegram:channel-ciberciac',
    label: '@ciberciac — últimas 24h',
    category: 'telegram',
    summary: '12 mensajes indexados',
  },
  {
    id: 'telegram:channel-cvenotify',
    label: '@cveNotify — alertas CVE',
    category: 'telegram',
    summary: '8 CVEs críticos',
  },
];
