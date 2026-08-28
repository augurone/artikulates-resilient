import { getPageView, pageApi } from './page-provider-barrel.js';
import { getPreviewPage } from './contentful-page-provider.js';
import { getPageView as backendPage } from './page-backends.js';
import * as cmsClient from 'contentful';

// A normalized page view owns an asset array; rendering must not treat it as text.
getPageView({}).assets.toUpperCase();
pageApi.getPageView({}).assets.toUpperCase();

// These represent a stale provider import, an ambiguous backend barrel, and an external boundary.
void [backendPage, cmsClient, getPreviewPage];
