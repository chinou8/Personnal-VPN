# Personnal-VPN
mon VPN

## INSTALLATION & USAGE

### Prérequis
- Windows 10/11 avec WireGuard installé (wg / wg-quick disponibles dans le PATH)
- Node.js (version récente LTS recommandée)

### Installation
1. Cloner le dépôt :
   ```bash
   git clone <URL_DU_DEPOT>
   cd Personnal-VPN
   ```
2. Installer les dépendances :
   ```bash
   npm install
   ```

### Lancement de l'application
```bash
npm start
```

### Ajouter un profil VPN
1. Cliquez sur "Ajouter un profil" dans l'application.
2. Saisissez le nom du profil et le chemin complet du fichier `.conf` WireGuard (ex: `C:\\vpn\\maison.conf`).
3. Validez : le profil apparaît dans la liste et peut être connecté via le bouton "Se connecter".

## Interface utilisateur
- Menu d'application en français (Fichier, Affichage, Aide) avec une fenêtre À propos.
- Panneau d'ajout de profil dédié pour saisir le nom et le chemin du fichier `.conf`.
- Liste des profils configurés avec affichage du statut (Déconnecté, Connexion en cours, Connecté, Erreur) et compteur de profils.
