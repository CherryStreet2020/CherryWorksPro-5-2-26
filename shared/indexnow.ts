/**
 * IndexNow ownership key (https://www.indexnow.org/documentation). PUBLIC BY DESIGN,
 * not a credential: the protocol proves we own cherryworkspro.com by serving this
 * exact string at /<key>.txt, and every submission carries it in the clear. Anyone
 * who reads it can only ask Bing to recrawl our own URLs.
 *
 * scripts/indexnow-ping.sh reads this line with sed — keep it on one line, in this form.
 * Rotating: change the value, deploy; the next ping uses the new key.
 */
export const INDEXNOW_KEY = "8cbf27ac3049948c80309214f5b9f578";
