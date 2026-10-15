export function validateHost({platform=process.platform,uid=process.getuid?.()}={}) {
 if(!['linux','darwin'].includes(platform)||!Number.isInteger(uid)||uid<=0)throw Error('Host mode requires a non-root Linux or macOS user');
}
