import { getItems } from './provider-barrel.js';
import external from 'external-package';

const loadDynamic = () => import('./dynamic-module.js');

getItems({ items: 'not-an-array', label: '' });
external;
loadDynamic;
