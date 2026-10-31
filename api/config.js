import { handleApi, loadEnvFiles } from "../lib/api.mjs";
loadEnvFiles();
export default function handler(req, res) { return handleApi(req, res); }
