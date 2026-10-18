export interface WardDirectoryEntry {
  code: string;
  name: string;
  area: string;
}

const LEGACY_WARD_CODES: Record<string, string> = {
  'A-Ward': 'A', 'G-South': 'G/S', 'H-West': 'H/W', 'K-West': 'K/W', 'F-North': 'F/N', 'S-Ward': 'S',
};

export function normalizeWardCode(code: string): string {
  return LEGACY_WARD_CODES[code] || code.replace('-', '/');
}

// Names provide a selectable geographic directory. Record counts and budgets
// are calculated from Arkiv results and are not prefilled here.
export const MUMBAI_WARDS: WardDirectoryEntry[] = [
  { code: 'A', name: 'Colaba · Fort · Nariman Point', area: 'Island City' },
  { code: 'B', name: 'Dongri · Bhendi Bazaar', area: 'Island City' },
  { code: 'C', name: 'Marine Lines · Kalbadevi', area: 'Island City' },
  { code: 'D', name: 'Malabar Hill · Grant Road', area: 'Island City' },
  { code: 'E', name: 'Byculla · Mazagaon', area: 'Island City' },
  { code: 'F/N', name: 'Matunga · Sion · Wadala', area: 'Island City' },
  { code: 'F/S', name: 'Parel · Sewri · Lalbaug', area: 'Island City' },
  { code: 'G/N', name: 'Dadar · Mahim · Dharavi', area: 'Island City' },
  { code: 'G/S', name: 'Worli · Lower Parel · Prabhadevi', area: 'Island City' },
  { code: 'H/E', name: 'Bandra East · Khar East', area: 'Western Suburbs' },
  { code: 'H/W', name: 'Bandra West · Khar West', area: 'Western Suburbs' },
  { code: 'K/E', name: 'Andheri East · Jogeshwari East', area: 'Western Suburbs' },
  { code: 'K/W', name: 'Andheri West · Juhu · Versova', area: 'Western Suburbs' },
  { code: 'L', name: 'Kurla · Chandivali', area: 'Eastern Suburbs' },
  { code: 'M/E', name: 'Govandi · Mankhurd · Chembur East', area: 'Eastern Suburbs' },
  { code: 'M/W', name: 'Chembur West · Mahul', area: 'Eastern Suburbs' },
  { code: 'N', name: 'Ghatkopar · Vikhroli', area: 'Eastern Suburbs' },
  { code: 'P/N', name: 'Malad · Marve', area: 'Western Suburbs' },
  { code: 'P/S', name: 'Goregaon · Aarey', area: 'Western Suburbs' },
  { code: 'R/N', name: 'Dahisar · Borivali North', area: 'Western Suburbs' },
  { code: 'R/S', name: 'Kandivali · Borivali South', area: 'Western Suburbs' },
  { code: 'R/C', name: 'Borivali · Magathane', area: 'Western Suburbs' },
  { code: 'S', name: 'Bhandup · Powai · Vikhroli East', area: 'Eastern Suburbs' },
  { code: 'T', name: 'Mulund', area: 'Eastern Suburbs' },
];
