import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { MediaStorageService } from './media-storage.service';
import {
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_STORAGE_CLIENT,
} from './storage.constants';

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_STORAGE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient | null => {
        const url = config.get<string>('SUPABASE_URL');
        const key = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
        if (!url || !key) {
          new Logger('StorageModule').warn(
            'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — Storage desabilitado',
          );
          return null;
        }
        return createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      },
    },
    {
      provide: SUPABASE_STORAGE_BUCKET,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string =>
        config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'wa-media',
    },
    MediaStorageService,
  ],
  exports: [MediaStorageService],
})
export class StorageModule {}
