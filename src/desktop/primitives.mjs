export const DESKTOP_SNAPSHOT_TTL_MS=30000;
export const DESKTOP_IMAGE_LIMIT_BYTES=2097152;
export class DesktopError extends Error{
 constructor(code,message){super(message);this.name='DesktopError';this.code=code;}
}
