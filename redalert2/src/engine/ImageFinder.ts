export class MissingImageError extends Error {
}
export class ImageFinder {
    static MissingImageError = MissingImageError;
    private images: Map<string, any>;
    private theater: any;
    constructor(images: Map<string, any>, theater: any) {
        this.images = images;
        this.theater = theater;
    }
    findByObjectArt(objectArt: {
        imageName: string;
        useTheaterExtension: boolean;
        useNewTheaterArt?: boolean;
    }) {
        return this.find(objectArt.imageName, objectArt.useTheaterExtension, objectArt.useNewTheaterArt);
    }
    find(artName: string, useTheaterExtension: boolean, useNewTheaterArt = false) {
        const filename = this.getFilename(artName, useTheaterExtension, useNewTheaterArt);
        const image = this.images.get(filename);
        if (!image) {
            throw new MissingImageError(`No image file found for artName="${artName}" (file=${filename})`);
        }
        return image;
    }
    tryFind(artName: string, useTheaterExtension: boolean, useNewTheaterArt = false) {
        let image;
        try {
            image = this.find(artName, useTheaterExtension, useNewTheaterArt);
        }
        catch (error) {
            if (!(error instanceof MissingImageError))
                throw error;
        }
        return image;
    }
    getFilename(artName: string, useTheaterExtension: boolean, useNewTheaterArt = false) {
        let filename = artName.toLowerCase();
        filename += useTheaterExtension ? this.theater.settings.extension : ".shp";
        filename = useNewTheaterArt
            ? this.applyNewTheater(filename)
            : this.applyNewTheaterIfNeeded(artName, filename);
        return filename;
    }
    applyNewTheaterIfNeeded(artName: string, filename: string) {
        const firstChar = artName[0];
        const secondChar = artName[1];
        if (["G", "N", "C", "Y"].indexOf(firstChar) === -1 ||
            ["A", "T"].indexOf(secondChar) === -1) {
            return filename;
        }
        return this.applyNewTheater(filename);
    }
    applyNewTheater(filename: string) {
        if (filename.length < 2) {
            return filename;
        }
        const firstChar = filename[0];
        const secondChar = filename[1].toUpperCase();
        if (!/^[a-z]$/i.test(firstChar) || !["A", "T"].includes(secondChar)) {
            return filename;
        }
        const rest = filename.substr(2);
        const newTheaterChar = this.theater.settings.newTheaterChar.toLowerCase();
        let newFilename = firstChar + newTheaterChar + rest;
        if (this.images.has(newFilename)) {
            return newFilename;
        }
        newFilename = firstChar + "g" + rest;
        if (this.images.has(newFilename)) {
            return newFilename;
        }
        return filename;
    }
}
