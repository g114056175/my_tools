// Compatibility facade for the platform-specific policy and existing callers.
import {createNetworkMediaObserver} from './network-observer.js';
export {serviceForPage,serviceForCdn} from './social-sites.js';
export const createSocialNetworkObserver=(api,options={})=>createNetworkMediaObserver(api,{...options,socialOnly:true});
