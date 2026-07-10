import { ContextCategory } from '../types/chat.types';

export const MOCK_CONTEXT_CATEGORIES: ContextCategory[] = [
  {
    id: 'ransomware',
    name: 'ransomware',
    label: 'Ransomware',
    color: '#ef4444',
  },
  {
    id: 'vuln-monitor',
    name: 'vuln-monitor',
    label: 'CVEs / Vuln Monitor',
    color: '#4a90d9',
  },
  { id: 'actors', name: 'actors', label: 'Threat Actors', color: '#e879f9' },
  {
    id: 'telegram',
    name: 'telegram',
    label: 'Alertas Telegram',
    color: '#4ade80',
  },
];
