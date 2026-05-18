import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SUPABASE_STORAGE_BUCKET } from './storage.constants';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Upload via REST API do Storage do Supabase usando fetch nativo.
 *
 * Substitui a versao anterior baseada em @supabase/supabase-js porque
 * a biblioteca (v2.105) tenta validar a service_role key como JWT antes
 * de fazer a request — e falha com "Invalid Compact JWS" quando a key
 * eh do formato novo (sb_secret_*).
 *
 * REST API direta funciona com qualquer formato (sb_secret_* ou JWT
 * legacy). Sem dependencia externa.
 *
 * Docs: https://supabase.com/docs/reference/javascript/storage-from-upload
 */
@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly supabaseUrl: string | null;
  private readonly serviceRoleKey: string | null;

  constructor(
    @Optional() private readonly config: ConfigService | null,
    @Inject(SUPABASE_STORAGE_BUCKET)
    private readonly bucket: string,
  ) {
    this.supabaseUrl = config?.get<string>('SUPABASE_URL') ?? null;
    this.serviceRoleKey = config?.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? null;
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      this.logger.warn('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — Storage desabilitado');
    }
  }

  isEnabled(): boolean {
    return !!this.supabaseUrl && !!this.serviceRoleKey;
  }

  async uploadImage(buffer: Buffer, path: string, mimeType: string): Promise<string | null> {
    if (!this.isEnabled()) return null;
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      this.logger.warn(`Imagem excede ${MAX_IMAGE_BYTES} bytes (${buffer.byteLength}) — ignorada`);
      return null;
    }

    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${encodedPath}`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          apikey: this.serviceRoleKey!,
          'Content-Type': mimeType,
          // Sem upsert — mantem comportamento anterior (falha se existir).
          'x-upsert': 'false',
        },
        body: buffer as any,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        this.logger.error(`Falha ao subir imagem (${path}): ${resp.status} ${text}`);
        return null;
      }

      return `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${encodedPath}`;
    } catch (err) {
      this.logger.error(`Erro de rede ao subir imagem (${path}): ${(err as Error).message}`);
      return null;
    }
  }
}
