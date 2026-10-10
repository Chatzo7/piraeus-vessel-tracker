# Deploying to Azure App Service

The app is a single Node.js process with an SQLite file, so it fits a Linux App Service plan.

## 1. Create the resources

With the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli):

```bash
az login
az group create --name rg-vessel-tracker --location westeurope

# B1 or higher: the ingest connection must stay open, and the Free tier
# stops idle apps (no "Always On").
az appservice plan create --name plan-vessel-tracker --resource-group rg-vessel-tracker \
  --sku B1 --is-linux

az webapp create --name <your-app-name> --resource-group rg-vessel-tracker \
  --plan plan-vessel-tracker --runtime "NODE:22-lts"
```

## 2. Configure

```bash
az webapp config appsettings set --name <your-app-name> --resource-group rg-vessel-tracker \
  --settings AISSTREAM_API_KEY=<your-key> DB_PATH=/home/data/tracker.db \
             SCM_DO_BUILD_DURING_DEPLOYMENT=false

az webapp config set --name <your-app-name> --resource-group rg-vessel-tracker \
  --always-on true --startup-file "npm start"
```

`/home` is persistent storage on App Service, so the database survives restarts and redeploys.
App Service sets `PORT` automatically; the app reads it.

To run the public demo instead of live data, set `DEMO=1` and leave out the API key.

## 3. Deploy

```bash
zip -r app.zip . -x ".git/*" "data/*" "node_modules/*"
az webapp deploy --name <your-app-name> --resource-group rg-vessel-tracker \
  --src-path app.zip --type zip
```

The app is then at `https://<your-app-name>.azurewebsites.net`.

## Clean up

```bash
az group delete --name rg-vessel-tracker
```

## Notes

- Check current pricing for the B1 plan in your region before creating it; new Azure accounts
  usually come with free credit for the first month.
- For heavier use, move storage to Azure Database for PostgreSQL; the SQL in `src/store.js`
  is kept close to standard SQL to make that straightforward.
