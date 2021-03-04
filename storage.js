/**
 * On créer une class Storage pour pouvoir gérer les données en JSON
 * de façon propre et indépendant au serveur pour éviter que deux écriture
 * ne se fasse en même temp pour éviter les corruptions
 * 
 * Le but ici c'est qu'il soit autonome et qu'il puisse gérer les petits imprévu 
 */
'use strict';

// fs (file system) permet d'écrire et lire les fichiers
const fs = require('fs');
// path permet de récuperer le bon path selon l'OS
const path = require('path');
// Comme le nom l'indique
const crypto = require('crypto');
const {EventEmitter} = require('events');

class Storage extends EventEmitter{
    constructor(dir, name) {
        super();
        // Path du dossier ou sont save les données
        this.dir = path.resolve(dir);

        // Nom du fichier
        this.name = name;

        // Path du fichier
        this.filePath = path.resolve(path.join(this.dir, `/${this.name}.json`));

        // Path du fichier backup
        this.backupFilePath = path.resolve(path.join(this.dir, `/${this.name}.backup.json`));

        // On met en cache les données
        this.cache = null;

        // On vérifie si il est nécéssaire de repeupler le cache
        this.fetch = true;

        // On vérifie si le processus d'écriture est en cours
        this.check = false;

        // Utile pour le processus de sauvegarde
        this.hash;
        this.actualHash;
    };

    init() {
        // On vérifie si le fichier data existe
        if (fs.existsSync(this.filePath)) {
            // On lis les données du fichier
            let data = fs.readFileSync(this.filePath, {encoding: 'utf8'});
            // On hash les données d'origine pour le comparer à la fin
            const originHash = crypto.createHash('sha256').update(data).digest('hex');

            // On vérifie la longueur du fichier pour déterminer si le fichier est corrompue
            if (data.length < 2) {
                // /!\ Fichier probablement corrompue ou nouveau
                this.emit('debug', '[STORAGE - %s] Data file is malformed or empty', this.name);
                // On charge le backup
                const backup = this.loadBackup();
                // Si il y a un backup l'assigner au data
                if (backup) {
                    this.emit('debug', '[STORAGE - %s] Buckup success', this.name);
                    data = backup;
                 } else this.emit('debug', '[STORAGE - %s] Buckup failed', this.name);
            };

            try {
                // On essaie de transformer le string en object
                data = JSON.parse(data);
                // On met cache les données
                this.cache = data;
                // On retirer la nécéssiter de repeupler le cache
                this.fetch = false;
                this.emit('debug', '[STORAGE - %s] data has been cached', this.name);
                // On hash les nouveau données
                const newHash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
                // Si les deux hash sont ps égaux ont 
                if (originHash != newHash) {
                    // Save le backup
                    fs.writeFileSync(this.filePath, data, {encoding: 'utf8'});
                };
            } catch (error) {
                // Les données sont malformer
                this.emit('debug', '[STORAGE - %s] Data file is corrupt', this.name);
                // /!\ Fichier probablement corrompue ou nouveau
                this.emit('debug', '[STORAGE - %s] Data file is malformed or empty', this.name);
                const backup = this.loadBackup();
                if (backup) data = backup;
                else this.health();
            };
        } else {
            // Créer une base pour les datas
            this.emit('debug', '[STORAGE - %s] Create new Data', this.name);
            fs.writeFileSync(this.filePath, '[]', {encoding: 'utf8'});
        };

        return this;
    };

    health() {
        // On charge une backup
        const backup = this.loadBackup();
        // Si le backup existe
        if (backup) {
            // Remplacer les données actuel par le backup
            let data = backup;
            fs.writeFileSync(this.filePath, JSON.stringify(data), {encoding: 'utf8'});
            this.emit('debug', '[STORAGE - %s] Data replace by backup');
        } else {
            // Reset les données
            this.emit('debug', '[STORAGE - %s] Buckup failed', this.name);
            fs.writeFileSync(this.filePath, '[]', {encoding: 'utf8'});
            this.emit('debug', '[STORAGE - %s] Data has been reset', this.name);
        };
    };

    loadBackup() {
        // On vérifie si le fichier data backup existe
        if (fs.existsSync(this.backupFilePath)) {
            // On lis les données du fichier
            let backup = fs.readFileSync(this.backupFilePath, {encoding: 'utf8'});

            // On vérifie la longueur du fichier pour déterminer si le fichier est corrompue
            if (backup.length < 2) {
                // /!\ Fichier probablement corrompue ou nouveau
                this.emit('debug', '[STORAGE - %s] Backup file is malformed or empty', this.name);
                return null;
            };

            try {
                // On essaie transformer le string en object
                return JSON.parse(backup);
            } catch (error) {
                // Le backup est malformer
                this.emit('debug', '[STORAGE - %s] Backup file is corrupt', this.name);
                return null;
            };
        };

        return null;
    };

    // Pour injecter des codes avec this dans notre instance
    injection(name, fn) {
        this.emit('debug', '[STORAGE - %s] %s injected', this.name, name);
        this[name] = fn.call(this);

        return this;
    };

    getData() {
        // On check les données dans le cache
        if (!this.fetch) return this.cache;
        else {
            let data;
            try {
                // On lis les données
                const raw = fs.readFileSync(this.filePath, {encoding: 'utf8'});
                data = JSON.parse(raw);
            } catch (error) {
                // On essaie de soigner les données
                this.health();
                // On lis données
                const raw = fs.readFileSync(this.filePath, {encoding: 'utf8'});
                data = JSON.parse(raw);
                // On met tout dans le cache
                this.cache = data;
                this.fetch = true;
            };

            // On retourne les données
            return data;
        };
    };

    saveData(data) {
        // on récuperer les données actuel
        const currentData = this.getData();
        
        // On check tout les element pour vérifier les doublons
        for (const element of data) {
            // Si l'element existe alors continuer la boucle
            if (this.cache && this.cache.some((d) => Object.is(d, element))) continue;
            // sinon push l'element dans les données
            else currentData.push(element);
        };

        // Enregistre dans le cache
        this.cache = currentData;
        this.fetch = false;

        // on créer un hash des dernieres data sauvegarder
        this.actualHash = crypto.createHash('sha256').update(JSON.stringify(this.cache)).digest('hex');
        this.emit('debug', '[STORAGE %s] Data loaded, hash: %s', this.name, this.hash);

        // Si l'écriture est toujours en cours alors retourner pour éviter une double écrite
        if (this.check) return this;
        // Mettre l'état d'écriture sur actif
        this.check = true;
        // On save le hash des données actuel
        this.hash = this.actualHash;

        // Ecrire le fichier
        fs.writeFile(this.filePath, JSON.stringify(currentData), {encoding: 'utf8'}, () => {
            // Mettre l'état d'écriture sur inactif
            this.check = false;
            this.emit('debug', '[STORAGE %s] Data saved, hash: %s', this.name, this.hash);
            // Vérifier si les données save on pas était update entre temp, si oui alors recommencer le processus
            if (this.hash != this.actualHash) return this.saveData(this.cache);
            // faire une backup
            this.makeBackup();
        });

        return this;
    };

    makeBackup() {
        try {
            // Utilisation basique
            fs.copyFileSync(this.filePath, this.backupFilePath, fs.constants.COPYFILE_FICLONE_FORCE);
        } catch (error) {
            this.emit('debug', '[STORAGE %s] Basic atempt for create backup failed', this.name);
            // La fonction copy n'est pas implémenter dans le systeme
            if (error.code == 'ENOSYS') {
                // On write les données dans le backup
                fs.writeFileSync(this.backupFilePath, JSON.stringify(this.cache), {encoding: 'utf8'});
            } else {
                // Si la copie forcer échoue alors supprimer le fichier de backup avant
                const name = Math.floor(Math.random() * 10e10);
                // On fais une copie du backup xD
                try {
                    fs.copyFileSync(this.backupFilePath, this.backupFilePath + '.temp.' + name);
                } catch (error) {/* Le fichier n'existe pas */}
    
                try {
                    fs.rmSync(this.backupFilePath, {force: true});
                } catch (error) {/* Le fichier n'existe toujours pas */}
    
                // On réessaie faire une copi du fichier
                fs.copyFileSync(this.filePath, this.backupFilePath, fs.constants.COPYFILE_FICLONE_FORCE);
    
                // On delete le fichier temp
                try {
                    fs.rmSync(this.backupFilePath + '.temp.' + name, {force: true});
                } catch (error) {/* Le fichier n'existe toujours pas */};
            };
        };
        this.emit('debug', '[STORAGE %s] Making backup', this.name);
    };
};

module.exports = Storage;