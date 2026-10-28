// Compatibility facade for the platform-specific policy and existing callers.
import {createNetworkMediaObserver} from '../../extension/network-observer.js';
export {serviceForPage,serviceForCdn} from '../../extension/social-sites.js';
export const createSocialNetworkObserver=(api,options={})=>createNetworkMediaObserver(api,{...options,socialOnly:true});
