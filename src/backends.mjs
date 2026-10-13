export function validateHost() {
 if(process.platform!=='linux'||!process.getuid?.())throw Error('Host mode requires a non-root Linux user');
}
