import { Global, Module } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';

@Global()
@Module({
  providers: [SessionManagerService],
  exports: [SessionManagerService],
})
export class BaileysModule {}
