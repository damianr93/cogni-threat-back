import { Injectable } from '@nestjs/common';

@Injectable()
export class RansomwareDataProcessorService {
  processVictimData(rawData: any) {
    return {
      discovered: rawData.discovered ? new Date(rawData.discovered) : new Date(),
      description: rawData.description || null,
      website: rawData.website || null,
      postUrl: rawData.post_url || null,
      country: rawData.country || null,
      activity: rawData.activity || null,
      duplicates: Array.isArray(rawData.duplicates)
        ? rawData.duplicates.map(dup => typeof dup === 'string' ? dup : JSON.stringify(dup))
        : [],
      extrainfos: Array.isArray(rawData.extrainfos)
        ? rawData.extrainfos.map(info => typeof info === 'string' ? info : JSON.stringify(info))
        : [],
      screenshot: rawData.screenshot || null,
      infostealer: rawData.infostealer ? JSON.stringify(rawData.infostealer) : null,
      press: rawData.press || null,
      ransomwareLiveId: rawData.id || `victim-${Date.now()}`,
      permalink: rawData.permalink || null,
      attackDate: rawData.attackdate ? new Date(rawData.attackdate) : null,
      victim: rawData.victim || 'Unknown Victim',
      group: rawData.group || 'Unknown Group',
    };
  }

  processGroupData(rawData: any) {
    const groupName = this.resolveGroupName(rawData);
    const altname = this.resolveAltName(rawData);
    const victims = this.resolveVictims(rawData);

    return {
      group: groupName,
      altname: altname || null,
      description: typeof rawData.description === 'string' ? rawData.description.trim() : null,
      victims,
      firstseen: rawData.firstseen ? new Date(rawData.firstseen) : null,
      lastseen: rawData.lastseen ? new Date(rawData.lastseen) : null,
      added_date: rawData.added_date ? new Date(rawData.added_date) : null,
      has_negotiations: rawData.has_negotiations ?? false,
      negotiation_count: typeof rawData.negotiation_count === 'number' ? rawData.negotiation_count : 0,
      has_ransomnote: rawData.has_ransomnote ?? false,
      ransomnotes_count: typeof rawData.ransomnotes_count === 'number' ? rawData.ransomnotes_count : 0,
      url: typeof rawData.url === 'string' ? rawData.url.trim() : null,
      ttps: Array.isArray(rawData.ttps) ? rawData.ttps.map((ttp: any) => typeof ttp === 'string' ? ttp : JSON.stringify(ttp)) : [],
      vulnerabilities: Array.isArray(rawData.vulnerabilities) ? rawData.vulnerabilities.map((vuln: any) => typeof vuln === 'string' ? vuln : JSON.stringify(vuln)) : [],
      tools: rawData.tools && typeof rawData.tools === 'object' ? rawData.tools : null,
      locations: Array.isArray(rawData.locations) ? rawData.locations : null,
    };
  }

  private resolveGroupName(data: any): string {
    if (typeof data?.group === 'string' && data.group.trim().length > 0) return data.group.trim();
    if (typeof data?.name === 'string' && data.name.trim().length > 0) return data.name.trim();
    if (typeof data?.title === 'string' && data.title.trim().length > 0) return data.title.trim();
    return 'Unknown Group';
  }

  private resolveAltName(data: any): string {
    if (typeof data?.altname === 'string' && data.altname.trim().length > 0) return data.altname.trim();
    if (Array.isArray(data?.aliases) && data.aliases.length > 0) return String(data.aliases[0]);
    return 'N/A';
  }

  private resolveVictims(data: any): number {
    if (typeof data?.victims === 'number' && Number.isFinite(data.victims)) return data.victims;
    if (typeof data?.victims_count === 'number' && Number.isFinite(data.victims_count)) return data.victims_count;
    if (typeof data?.total_victims === 'number' && Number.isFinite(data.total_victims)) return data.total_victims;
    return 0;
  }
}
