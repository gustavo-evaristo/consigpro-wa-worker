import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaStorageService } from './media-storage.service';
import { SUPABASE_STORAGE_BUCKET } from './storage.constants';

@Global()
@Module({
  providers: [
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
